import {
	EventsSDK,
	GameState,
	Unit,
	LocalPlayer,
	DOTAGameUIState,
	TaskManager,
	Shop,
	ShopType
} from "github.com/octarine-public/wrapper/index"

// Структура для настройки автоматической покупки предметов
interface ItemToBuy {
	id: number       // ID предмета
	name: string     // Имя предмета для логов
	itemName: string // Имя предмета в инвентаре
	dispenser?: string // Имя диспенсера, если предмет может быть в нем
}

// Массив предметов для автоматической покупки
const ITEMS_TO_BUY: ItemToBuy[] = [
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

// Функция для покупки предмета
function buyItem(hero: Unit, item: ItemToBuy) {
	console.log(`Покупаем ${item.name}`)
	
	// Используем TaskManager для надежности
	TaskManager.Begin(() => {
		if (hero.IsValid && hero.IsAlive) {
			hero.PurchaseItem(item.id, false, false)
		}
	})
}

// Функция для подсчета количества предметов в инвентаре (для информации)
function countItems(hero: Unit, item: ItemToBuy): number {
	let count = 0
	
	// Проверяем все предметы в инвентаре
	for (const inventoryItem of hero.Items) {
		if (inventoryItem.Name === item.itemName) {
			count += inventoryItem.CurrentCharges
		}
		
		// Проверяем также диспенсер, если он указан
		if (item.dispenser && inventoryItem.Name === item.dispenser) {
			count += inventoryItem.CurrentCharges
		}
	}
	
	return count
}

// Проверка, доступен ли предмет в магазине
function isItemAvailable(item: ItemToBuy): boolean {
	return Shop.GetItemStockCount(item.id, ShopType.Base) > 0
}

// Основная функция для проверки и покупки предметов
function checkAndBuyItems() {
	// Получаем локального героя
	const hero = LocalPlayer?.Hero
	
	// Проверяем, что герой существует и жив
	if (hero && hero.IsValid && hero.IsAlive) {
		// Проверяем каждый предмет из списка
		for (const item of ITEMS_TO_BUY) {
			// Подсчитываем количество предметов в инвентаре (только для логов)
			const itemCount = countItems(hero, item)
			
			// Проверяем, доступен ли предмет в магазине
			const available = isItemAvailable(item)
			const stockCount = Shop.GetItemStockCount(item.id, ShopType.Base)
			
			console.log(`${item.name}: в инвентаре ${itemCount}, доступно в магазине: ${stockCount}`)
			
			// Если предмет доступен, покупаем его
			if (available) {
				buyItem(hero, item)
			}
		}
	}
}

// Переменная для отслеживания времени последней проверки
let lastCheckTime = 0

// Интервал регулярной проверки (в секундах)
const CHECK_INTERVAL = 5 // Проверять каждые 5 секунд для регулярных проверок

// Запускаем проверку при старте игры
EventsSDK.on("GameStarted", () => {
	console.log("Скрипт автоматической покупки предметов запущен!")
	
	// Устанавливаем начальное время проверки
	lastCheckTime = GameState.RawGameTime
})

// Проверяем периодически и при обновлении магазина
EventsSDK.on("Tick", () => {
	// Проверяем, находимся ли мы в игре
	if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
		return
	}
	
	// Проверка при обновлении магазина
	if (Shop.LastUpdateTick) {
		checkAndBuyItems()
	}
	
	// Регулярная проверка каждые CHECK_INTERVAL секунд
	const currentTime = GameState.RawGameTime
	if (currentTime - lastCheckTime >= CHECK_INTERVAL) {
		checkAndBuyItems()
		lastCheckTime = currentTime
	}
})

// Также проверяем при возрождении героя
EventsSDK.on("UnitSpawned", unit => {
	// Проверяем, что это локальный герой
	if (unit === LocalPlayer?.Hero) {
		console.log("Герой возродился, проверяем наличие предметов")
		checkAndBuyItems()
	}
})
