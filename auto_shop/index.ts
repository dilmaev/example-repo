import {
	EventsSDK,
	GameState,
	Unit,
	LocalPlayer,
	DOTAGameUIState,
	TaskManager,
	GameRules,
	AbilityData,
	Sleeper
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

// Структура для настройки автоматической покупки предметов
interface ItemToBuy {
	id: number       // ID предмета
	name: string     // Имя предмета для логов
	itemName: string // Имя предмета в инвентаре
	dispenser?: string // Имя диспенсера, если предмет может быть в нем
}

new (class CAutoShop {
	// Массив предметов для автоматической покупки
	private readonly ITEMS_TO_BUY: ItemToBuy[] = [
		{
			id: 42,
			name: "Observer Ward",
			itemName: "item_ward_observer",
			dispenser: "item_ward_dispenser"
		},
		{
			id: 43,
			name: "Sentry Ward",
			itemName: "item_ward_sentry",
			dispenser: "item_ward_dispenser"
		},
		{
			id: 188,
			name: "Smoke of Deceit",
			itemName: "item_smoke_of_deceit"
		}
		// Можно добавить другие предметы, просто добавив новые объекты в этот массив
	]
	
	// Минимальный интервал между покупками одного и того же предмета (в секундах)
	private readonly PURCHASE_COOLDOWN = 1
	
	// Переменная для отслеживания времени последней проверки
	private lastCheckTime = 0
	
	// Объект для ограничения частоты операций
	private readonly sleeper = new Sleeper()
	
	// Объект меню
	private readonly menu = new MenuManager()
	
	constructor() {
		// Подписываемся на события
		EventsSDK.on("GameStarted", this.GameStarted.bind(this))
		EventsSDK.on("Tick", this.Tick.bind(this))
		EventsSDK.on("UnitSpawned", this.UnitSpawned.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}
	
	// Проверяем, доступен ли предмет в магазине
	private isItemAvailable(itemName: string): boolean {
		// Проверка наличия GameRules
		if (!GameRules || !GameRules.StockInfo) {
			return false
		}
		
		// Проверяем каждый элемент в StockInfo
		for (const stock of GameRules.StockInfo) {
			// Убедимся, что stock валидный и имеет необходимые функции
			if (!stock || !stock.GetAbilityName) {
				continue
			}
			
			try {
				// Получаем имя предмета в магазине
				const stockItemName = stock.GetAbilityName()
				
				// Проверяем, совпадает ли имя с искомым и есть ли предмет в наличии
				if (stockItemName === itemName && stock.StockCount > 0) {
					console.log(`[ДОСТУПЕН] ${itemName}: ${stock.StockCount} шт.`)
					return true
				}
			} catch (e) {
				// В случае ошибки продолжаем проверку других предметов
				continue
			}
		}
		
		console.log(`[НЕДОСТУПЕН] ${itemName}`)
		return false
	}
	
	// Функция для покупки предмета
	private buyItem(hero: Unit, item: ItemToBuy) {
		// Если слипер активен, пропускаем покупку
		if (this.sleeper.Sleeping(`buy_${item.itemName}`)) {
			return
		}
		
		// Проверяем, включен ли этот предмет в меню
		if (!this.menu.isItemEnabled(item.itemName)) {
			return
		}
		
		// Проверяем доступность предмета в магазине напрямую
		if (!this.isItemAvailable(item.itemName)) {
			return
		}
		
		console.log(`=== ПОКУПАЕМ ${item.name} ===`)
		
		// Используем TaskManager для надежного выполнения покупки
		TaskManager.Begin(() => {
			if (hero.IsValid) {
				hero.PurchaseItem(item.id, false, false)
				this.sleeper.Sleep(this.PURCHASE_COOLDOWN * 1000, `buy_${item.itemName}`)
			}
		})
	}
	
	// Основная функция для проверки и покупки предметов
	private checkAndBuyItems() {
		// Если скрипт выключен в меню, прекращаем выполнение
		if (!this.menu.State.value) {
			return
		}
		
		// Получаем локального героя
		const hero = LocalPlayer?.Hero
		
		// Проверяем, что герой существует
		if (hero && hero.IsValid) {
			// Для каждого предмета проверяем, доступен ли он, и пытаемся купить
			for (const item of this.ITEMS_TO_BUY) {
				this.buyItem(hero, item)
			}
		}
	}
	
	// Обработчик события начала игры
	private GameStarted() {
		console.log("== Игра начата ==")
		this.lastCheckTime = GameState.RawGameTime
		this.sleeper.FullReset()
	}
	
	// Обработчик события окончания игры
	private GameEnded() {
		console.log("== Игра окончена ==")
		this.sleeper.FullReset()
	}
	
	// Обработчик тика игры
	private Tick() {
		// Проверяем, находимся ли мы в игре
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return
		}
		
		// Получаем интервал проверки из меню
		const checkInterval = this.menu.CheckInterval
		
		// Регулярная проверка каждые checkInterval секунд
		const currentTime = GameState.RawGameTime
		if (currentTime - this.lastCheckTime >= checkInterval) {
			this.checkAndBuyItems()
			this.lastCheckTime = currentTime
		}
	}
	
	// Обработчик появления юнита
	private UnitSpawned(unit: Unit) {
		// Проверяем, что это локальный герой
		if (unit === LocalPlayer?.Hero) {
			// Устанавливаем время последней проверки немного в прошлое,
			// чтобы проверка выполнилась при следующем тике
			this.lastCheckTime = GameState.RawGameTime - this.menu.CheckInterval + 0.1
		}
	}
})()