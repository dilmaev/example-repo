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
	
	// Кэш для хранения доступности предметов
	private availableItemsCache: Map<string, boolean> | null = null
	private lastCacheUpdateTime = 0
	
	// Переменная для отслеживания времени последней покупки каждого предмета
	private readonly lastPurchaseTime = new Map<string, number>()
	
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
	
	// Функция для создания карты предметов, доступных в магазине
	private getAvailableItemsMap(): Map<string, boolean> {
		const availableItems = new Map<string, boolean>()
		
		// Проверяем, что GameRules существует
		if (!GameRules) {
			console.log("GameRules не существует")
			return availableItems
		}
		
		// Выводим в консоль текущие доступные предметы для отладки
		console.log("=== Начало проверки StockInfo ===")
		
		// Проверяем, что StockInfo существует и содержит элементы
		if (!GameRules.StockInfo || GameRules.StockInfo.length === 0) {
			console.log("StockInfo пуст или не существует")
			return availableItems
		}
		
		console.log(`Найдено ${GameRules.StockInfo.length} предметов в StockInfo`)
		
		// Проходим по всем предметам в StockInfo и отмечаем доступные
		for (const stock of GameRules.StockInfo) {
			// Проверяем валидность объекта stock
			if (!stock || typeof stock.GetAbilityName !== 'function' || typeof stock.StockCount !== 'number') {
				console.log("Невалидный элемент в StockInfo")
				continue
			}
			
			try {
				const stockItemName = stock.GetAbilityName()
				const stockCount = stock.StockCount
				
				// Проверяем имя и количество
				if (!stockItemName || stockCount === undefined) {
					continue
				}
				
				// Записываем информацию о важных предметах
				const isWatchedItem = this.ITEMS_TO_BUY.some(item => item.itemName === stockItemName)
				if (isWatchedItem) {
					console.log(`Важный предмет ${stockItemName}: доступно ${stockCount}`)
				}
				
				if (stockCount > 0) {
					availableItems.set(stockItemName, true)
				}
			} catch (e) {
				console.log(`Ошибка при получении данных предмета: ${e}`)
			}
		}
		
		console.log(`Всего доступно ${availableItems.size} предметов`)
		
		// Выводим список предметов, которые мы хотим купить
		for (const item of this.ITEMS_TO_BUY) {
			if (this.menu.isItemEnabled(item.itemName)) {
				const isAvailable = availableItems.has(item.itemName)
				console.log(`Предмет для покупки ${item.name} (${item.itemName}): ${isAvailable ? 'ДОСТУПЕН' : 'НЕДОСТУПЕН'} в магазине`)
			} else {
				console.log(`Предмет ${item.name} (${item.itemName}) отключен в меню`)
			}
		}
		
		console.log("=== Конец проверки StockInfo ===")
		return availableItems
	}
	
	// Функция для проверки, доступен ли предмет в лавке
	private isItemAvailable(item: ItemToBuy): boolean {
		// Проверяем, включен ли этот предмет в меню
		if (!this.menu.isItemEnabled(item.itemName)) {
			return false
		}
		
		const now = GameState.RawGameTime
		
		// Обновляем кэш доступных предметов, если прошло больше времени кэширования или кэш не создан
		const cacheTime = 2 // Время в секундах, в течение которого кэш считается актуальным
		if (!this.availableItemsCache || now - this.lastCacheUpdateTime >= cacheTime) {
			this.availableItemsCache = this.getAvailableItemsMap()
			this.lastCacheUpdateTime = now
		}
		
		// Проверяем, есть ли предмет в кэше доступных предметов
		const available = this.availableItemsCache.has(item.itemName)
		if (!available) {
			console.log(`Проверка доступности: ${item.name} (${item.itemName}) НЕДОСТУПЕН в магазине`)
		}
		return available
	}
	
	// Функция для покупки предмета
	private buyItem(hero: Unit, item: ItemToBuy) {
		// Финальная проверка наличия предмета в кэше доступных предметов
		// Это гарантирует, что мы не попытаемся купить предмет, который недоступен
		if (!this.availableItemsCache || !this.availableItemsCache.has(item.itemName)) {
			console.log(`ОТМЕНА ПОКУПКИ: ${item.name} отсутствует в кэше доступных предметов`)
			return false
		}
		
		// Проверяем, не спит ли покупка для этого предмета
		if (this.sleeper.Sleeping(`buy_${item.itemName}`)) {
			console.log(`Слипер активен для ${item.name}, пропускаем покупку`)
			return false
		}
		
		// Выводим информацию о покупке
		console.log(`=== ПОКУПАЕМ ${item.name} ===`)
		
		// Используем TaskManager для надежного выполнения покупки
		TaskManager.Begin(() => {
			if (hero.IsValid) {
				hero.PurchaseItem(item.id, false, false)
				// Устанавливаем слипер для предотвращения повторной покупки
				this.sleeper.Sleep(this.PURCHASE_COOLDOWN * 1000, `buy_${item.itemName}`)
				console.log(`Установлен слипер на ${this.PURCHASE_COOLDOWN} сек для ${item.name}`)
				return true
			} else {
				console.log(`Герой невалиден, не удалось купить ${item.name}`)
				return false
			}
		})
		
		return true
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
			// Сначала обновляем кэш доступных предметов
			const now = GameState.RawGameTime
			const cacheTime = 2 // Время в секундах, в течение которого кэш считается актуальным
			
			if (!this.availableItemsCache || now - this.lastCacheUpdateTime >= cacheTime) {
				console.log("Обновляем кэш доступных предметов перед проверкой")
				this.availableItemsCache = this.getAvailableItemsMap()
				this.lastCacheUpdateTime = now
			}
			
			// Для каждого предмета пытаемся купить, если он доступен в лавке
			let itemsPurchased = 0
			
			for (const item of this.ITEMS_TO_BUY) {
				// Проверяем доступность с использованием обновленного кэша
				if (this.menu.isItemEnabled(item.itemName) && 
					this.availableItemsCache && 
					this.availableItemsCache.has(item.itemName) &&
					!this.sleeper.Sleeping(`buy_${item.itemName}`)) {
					
					if (this.buyItem(hero, item)) {
						itemsPurchased++
					}
				}
			}
			
			if (itemsPurchased === 0) {
				console.log("Нет доступных предметов для покупки в этой проверке")
			}
		}
	}
	
	// Обработчик события начала игры
	private GameStarted() {
		// Сбрасываем кэши при старте игры
		console.log("== Игра начата: сброс кэша ==")
		this.availableItemsCache = null
		this.lastCacheUpdateTime = 0
		this.lastCheckTime = GameState.RawGameTime
		this.sleeper.FullReset()
	}
	
	// Обработчик события окончания игры
	private GameEnded() {
		// Сбрасываем кэши при окончании игры
		console.log("== Игра окончена: сброс кэша ==")
		this.availableItemsCache = null
		this.lastCacheUpdateTime = 0
		this.sleeper.FullReset()
	}
	
	// Обработчик тика игры
	private Tick() {
		// Проверяем, находимся ли мы в игре
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return
		}
		
		// Получаем интервал проверки из меню (через getter)
		const checkInterval = this.menu.CheckInterval
		
		// Регулярная проверка каждые checkInterval секунд
		const currentTime = GameState.RawGameTime
		if (currentTime - this.lastCheckTime >= checkInterval) {
			console.log(`Выполняем проверку при интервале ${checkInterval} сек. (значение слайдера: ${this.menu.CheckIntervalSlider.value})`)
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