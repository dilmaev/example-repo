import {
	EventsSDK,
	GameState,
	Unit,
	LocalPlayer,
	DOTAGameUIState,
	TaskManager,
	GameRules,
	AbilityData
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

// Функция для проверки, доступен ли предмет в лавке
function isItemAvailable(item: ItemToBuy): boolean {
	// Проверяем, что GameRules существует
	if (!GameRules) {
		console.log("GameRules не определен")
		return false
	}

	// Получаем информацию о предмете
	const abilityData = AbilityData.GetAbilityByName(item.itemName)
	if (!abilityData) {
		console.log(`Не найдена информация о предмете ${item.name} (itemName: ${item.itemName})`)
		return false
	}

	// Проверяем наличие предмета в StockInfo
	for (const stock of GameRules.StockInfo) {
		console.log(`Проверяем предмет ${item.name}: AbilityID=${stock.AbilityID}, StockCount=${stock.StockCount}`)
		if (stock.GetAbilityName() === item.itemName) {
			console.log(`${item.name}: доступно ${stock.StockCount} шт.`)
			return stock.StockCount > 0
		}
	}

	console.log(`${item.name} не найден в StockInfo`)
	return false
}

// Функция для покупки предмета
function buyItem(hero: Unit, item: ItemToBuy) {
	console.log(`Покупаем ${item.name}`)
	
	// Используем TaskManager для надежного выполнения покупки
	TaskManager.Begin(() => {
		if (hero.IsValid && hero.IsAlive) {
			hero.PurchaseItem(item.id, false, false)
		}
	})
}

// Основная функция для проверки и покупки предметов
function checkAndBuyItems() {
	// Получаем локального героя
	const hero = LocalPlayer?.Hero
	
	// Проверяем, что герой существует и жив
	if (hero && hero.IsValid && hero.IsAlive) {
		// Для каждого предмета пытаемся купить, если он доступен в лавке
		for (const item of ITEMS_TO_BUY) {
			if (isItemAvailable(item)) {
				buyItem(hero, item)
			} else {
				console.log(`${item.name} недоступен в лавке`)
			}
		}
	}
}

// Переменная для отслеживания времени последней проверки
let lastCheckTime = 0

// Интервал регулярной проверки (в секундах)
const CHECK_INTERVAL = 1 // Проверять каждую секунду для быстрой покупки

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
