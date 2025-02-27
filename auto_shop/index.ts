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

// Кэш для хранения доступности предметов
const itemAvailabilityCache = new Map<string, { available: boolean, lastChecked: number }>()

// Время в секундах, в течение которого кэш считается актуальным
const CACHE_TTL = 2

// Функция для проверки, доступен ли предмет в лавке
function isItemAvailable(item: ItemToBuy): boolean {
	// Проверяем кэш
	const now = GameState.RawGameTime
	const cacheKey = item.itemName
	const cachedValue = itemAvailabilityCache.get(cacheKey)
	
	// Если в кэше есть актуальное значение, используем его
	if (cachedValue && now - cachedValue.lastChecked < CACHE_TTL) {
		return cachedValue.available
	}
	
	// Проверяем, что GameRules существует
	if (!GameRules) {
		return false
	}

	// Получаем информацию о предмете (используем только itemName для проверки)
	let isAvailable = false
	
	// Оптимизированная проверка наличия предмета в StockInfo
	for (const stock of GameRules.StockInfo) {
		const stockItemName = stock.GetAbilityName()
		if (stockItemName === item.itemName && stock.StockCount > 0) {
			isAvailable = true
			break
		}
	}
	
	// Сохраняем результат в кэш
	itemAvailabilityCache.set(cacheKey, { available: isAvailable, lastChecked: now })
	
	return isAvailable
}

// Переменная для отслеживания времени последней покупки каждого предмета
const lastPurchaseTime = new Map<string, number>()

// Минимальный интервал между покупками одного и того же предмета (в секундах)
const PURCHASE_COOLDOWN = 1

// Функция для покупки предмета
function buyItem(hero: Unit, item: ItemToBuy) {
	const now = GameState.RawGameTime
	const lastPurchase = lastPurchaseTime.get(item.itemName) || 0
	
	// Проверяем, прошло ли достаточно времени с последней покупки этого предмета
	if (now - lastPurchase < PURCHASE_COOLDOWN) {
		return
	}
	
	// Используем TaskManager для надежного выполнения покупки, но без лишних проверок внутри
	TaskManager.Begin(() => {
		if (hero.IsValid) {
			hero.PurchaseItem(item.id, false, false)
			lastPurchaseTime.set(item.itemName, now)
		}
	})
}

// Основная функция для проверки и покупки предметов
function checkAndBuyItems() {
	// Получаем локального героя
	const hero = LocalPlayer?.Hero
	
	// Проверяем, что герой существует
	if (hero && hero.IsValid) {
		// Для каждого предмета пытаемся купить, если он доступен в лавке
		for (const item of ITEMS_TO_BUY) {
			if (isItemAvailable(item)) {
				buyItem(hero, item)
			}
		}
	}
}

// Переменная для отслеживания времени последней проверки
let lastCheckTime = 0

// Интервал регулярной проверки (в секундах)
const CHECK_INTERVAL = 2 // Увеличиваем интервал проверки для снижения нагрузки

// Запускаем проверку при старте игры
EventsSDK.on("GameStarted", () => {
	// Сбрасываем кэши при старте игры
	itemAvailabilityCache.clear()
	lastPurchaseTime.clear()
	
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

// Также проверяем при возрождении героя, но с использованием таймера
EventsSDK.on("UnitSpawned", unit => {
	// Проверяем, что это локальный герой
	if (unit === LocalPlayer?.Hero) {
		// Устанавливаем время последней проверки немного в прошлое,
		// чтобы проверка выполнилась при следующем тике
		lastCheckTime = GameState.RawGameTime - CHECK_INTERVAL + 0.5
	}
}) 