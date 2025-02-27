import {
	EventsSDK,
	GameState,
	Unit,
	LocalPlayer,
	DOTAGameUIState,
	TaskManager
} from "github.com/octarine-public/wrapper/index"

// Структура для настройки автоматической покупки предметов
interface ItemToBuy {
	id: number       // ID предмета
	name: string     // Имя предмета для логов
	itemName: string // Имя предмета в инвентаре
	dispenser?: string // Имя диспенсера, если предмет может быть в нем
	minCount: number   // Минимальное количество предметов, которое нужно иметь
}

// Массив предметов для автоматической покупки
const ITEMS_TO_BUY: ItemToBuy[] = [
	{
		id: 42,
		name: "Observer Ward",
		itemName: "item_ward_observer",
		dispenser: "item_ward_dispenser",
		minCount: 2
	},
	{
		id: 43,
		name: "Sentry Ward",
		itemName: "item_ward_sentry",
		dispenser: "item_ward_dispenser",
		minCount: 2
	},
	{
		id: 188,
		name: "Smoke of Deceit",
		itemName: "item_smoke_of_deceit",
		minCount: 1
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

// Функция для подсчета количества предметов в инвентаре
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

// Основная функция для проверки и покупки предметов
function checkAndBuyItems() {
	// Получаем локального героя
	const hero = LocalPlayer?.Hero
	
	// Проверяем, что герой существует и жив
	if (hero && hero.IsValid && hero.IsAlive) {
		// Проверяем каждый предмет из списка
		for (const item of ITEMS_TO_BUY) {
			// Подсчитываем количество предметов в инвентаре
			const itemCount = countItems(hero, item)
			
			console.log(`${item.name}: в инвентаре ${itemCount}`)
			
			// Если количество предметов меньше минимального, пытаемся купить
			if (itemCount < item.minCount) {
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

// Проверяем периодически
EventsSDK.on("Tick", () => {
	// Проверяем, находимся ли мы в игре
	if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
		return
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
