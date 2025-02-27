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
	cost?: number    // Стоимость предмета
}

// Результат проверки доступности предмета
interface ItemAvailabilityResult {
	available: boolean // Доступен ли предмет
	count: number      // Количество доступных предметов
}

new (class CAutoShop {
	// Массив предметов для автоматической покупки
	private readonly ITEMS_TO_BUY: ItemToBuy[] = [
		{
			id: 42,
			name: "Observer Ward",
			itemName: "item_ward_observer",
			dispenser: "item_ward_dispenser",
			cost: 0 // Observer Ward бесплатны
		},
		{
			id: 43,
			name: "Sentry Ward",
			itemName: "item_ward_sentry",
			dispenser: "item_ward_dispenser",
			cost: 50 // Стоимость Sentry Ward
		},
		{
			id: 188,
			name: "Smoke of Deceit",
			itemName: "item_smoke_of_deceit",
			cost: 50 // Стоимость Smoke
		}
		// Можно добавить другие предметы, просто добавив новые объекты в этот массив
	]
	
	// Минимальный интервал между покупками одного и того же предмета (в секундах)
	private readonly PURCHASE_COOLDOWN = 1
	
	// Количество предметов, при котором включается режим "агрессивной" покупки
	private readonly FAST_PURCHASE_THRESHOLD = 3
	
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
	
	// Получаем текущее золото героя
	private getHeroGold(hero: Unit): number {
		if (!hero || !hero.IsValid) {
			console.log("Герой не существует или невалиден")
			return 0
		}
		
		// Получаем текущее золото
		try {
			const gold = hero.Gold || 0
			console.log(`Текущее золото героя: ${gold}`)
			return gold
		} catch (e) {
			console.log(`Ошибка при получении золота: ${e}`)
			return 9999 // Возвращаем большое число, чтобы не блокировать покупку в случае ошибки
		}
	}
	
	// Проверяем, доступен ли предмет в магазине
	private checkItemAvailability(itemName: string): ItemAvailabilityResult {
		const result: ItemAvailabilityResult = { available: false, count: 0 }
		
		// Проверка наличия GameRules
		if (!GameRules || !GameRules.StockInfo) {
			console.log("GameRules.StockInfo отсутствует")
			return result
		}
		
		// Получаем команду локального игрока
		const playerTeam = LocalPlayer?.Hero?.Team
		if (playerTeam === undefined) {
			console.log("Не удалось определить команду игрока")
			return result
		}
		
		// Проверяем каждый элемент в StockInfo
		for (const stock of GameRules.StockInfo) {
			// Убедимся, что stock валидный и имеет необходимые функции
			if (!stock || !stock.GetAbilityName || stock.Team === undefined) {
				continue
			}
			
			try {
				// Получаем имя предмета в магазине
				const stockItemName = stock.GetAbilityName()
				const stockTeam = stock.Team
				
				// Проверяем, совпадает ли имя с искомым, есть ли предмет в наличии и принадлежит ли он нашей команде
				if (stockItemName === itemName && stock.StockCount > 0 && stockTeam === playerTeam) {
					result.available = true
					result.count = stock.StockCount
					console.log(`[ДОСТУПЕН] ${itemName}: ${result.count} шт. в лавке нашей команды (${playerTeam})`)
					return result
				} else if (stockItemName === itemName) {
					// Дополнительный лог для отладки
					const teamStr = stock.Team !== playerTeam ? "вражеской" : "нашей"
					console.log(`[ИНФОРМАЦИЯ] ${itemName}: ${stock.StockCount} шт. в лавке ${teamStr} команды (${stock.Team}), наша команда ${playerTeam}`)
				}
			} catch (e) {
				// В случае ошибки продолжаем проверку других предметов
				console.log(`Ошибка при проверке предмета: ${e}`)
				continue
			}
		}
		
		console.log(`[НЕДОСТУПЕН] ${itemName} в лавке нашей команды (${playerTeam})`)
		return result
	}
	
	// Проверяем, хватает ли золота на предмет
	private hasEnoughGold(hero: Unit, itemCost: number): boolean {
		// Если предмет бесплатный, всегда возвращаем true
		if (!itemCost || itemCost <= 0) {
			return true
		}
		
		const gold = this.getHeroGold(hero)
		const hasEnough = gold >= itemCost
		
		console.log(`Проверка золота: ${gold} / ${itemCost} (${hasEnough ? 'достаточно' : 'недостаточно'})`)
		
		return hasEnough
	}
	
	// Функция для быстрой покупки нескольких одинаковых предметов
	private bulkBuyItem(hero: Unit, item: ItemToBuy, count: number) {
		// Получаем текущее золото героя
		const currentGold = this.getHeroGold(hero)
		
		// Безопасно проверяем стоимость предмета
		const itemCost = item.cost || 0
		
		// Максимальное количество предметов для быстрой покупки, с учетом золота
		const maxAffordable = itemCost > 0 ? Math.floor(currentGold / itemCost) : count
		console.log(`Можно купить предметов: ${maxAffordable} (золото: ${currentGold}, стоимость: ${itemCost})`)
		
		const maxItems = Math.min(count, maxAffordable, 10) // Ограничиваем до 10, чтобы избежать проблем
		
		if (maxItems <= 0) {
			console.log(`Недостаточно золота для покупки ${item.name} (нужно ${itemCost}, есть ${currentGold})`)
			return
		}
		
		console.log(`=== БЫСТРАЯ ПОКУПКА ${item.name} (${maxItems} из ${count} шт.) ===`)
		
		// Последовательно покупаем предметы без задержки
		for (let i = 0; i < maxItems; i++) {
			TaskManager.Begin(() => {
				if (hero.IsValid) {
					console.log(`Покупаем ${item.name} #${i + 1}, айди: ${item.id}`)
					hero.PurchaseItem(item.id, false, false)
				}
			})
		}
		
		// После массовой покупки устанавливаем слипер
		this.sleeper.Sleep(this.PURCHASE_COOLDOWN * 1000, `buy_${item.itemName}`)
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
		const availability = this.checkItemAvailability(item.itemName)
		if (!availability.available) {
			return
		}
		
		// Получаем стоимость предмета (безопасно)
		const itemCost = item.cost || 0
		console.log(`Проверка для покупки ${item.name} (стоимость: ${itemCost})`)
		
		// Проверяем, достаточно ли золота для покупки
		if (!this.hasEnoughGold(hero, itemCost)) {
			return
		}
		
		// Если предметов много, используем массовую покупку
		if (availability.count >= this.FAST_PURCHASE_THRESHOLD) {
			this.bulkBuyItem(hero, item, availability.count)
			return
		}
		
		// Стандартная покупка одного предмета
		console.log(`=== ПОКУПАЕМ ${item.name} (id: ${item.id}, стоимость: ${itemCost}) ===`)
		
		// Используем TaskManager для надежного выполнения покупки
		TaskManager.Begin(() => {
			if (hero.IsValid) {
				console.log(`Отправляем команду на покупку ${item.name} (id: ${item.id})`)
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