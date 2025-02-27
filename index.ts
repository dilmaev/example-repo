import {
	EventsSDK,
	GameState,
	Unit,
	LocalPlayer,
	DOTAGameUIState,
	TaskManager
} from "github.com/octarine-public/wrapper/index"

// ID предмета Observer Ward
const OBSERVER_WARD_ID = 42 // ID Observer Ward

// Интервал проверки и покупки вардов (в секундах)
const CHECK_INTERVAL = 60 // Проверять каждую минуту

// Минимальное количество вардов, которое нужно иметь
const MIN_WARDS_COUNT = 2

// Функция для покупки Observer Ward
function buyObserverWard(hero: Unit) {
	// Проверяем, есть ли у героя достаточно золота (хотя Observer Ward бесплатны)
	console.log("Покупаем Observer Ward")
	
	// Используем метод PurchaseItem для покупки Observer Ward
	// Запускаем покупку через TaskManager для надежности
	TaskManager.Begin(() => {
		if (hero.IsValid && hero.IsAlive) {
			hero.PurchaseItem(OBSERVER_WARD_ID, false, false)
		}
	})
}

// Функция для подсчета количества Observer Ward в инвентаре
function countObserverWards(hero: Unit): number {
	let count = 0
	
	// Проверяем все предметы в инвентаре
	for (const item of hero.Items) {
		if (item.Name === "item_ward_observer") {
			count += item.CurrentCharges
		}
		
		// Проверяем также ward dispenser, который может содержать observer wards
		if (item.Name === "item_ward_dispenser") {
			count += item.CurrentCharges
		}
	}
	
	return count
}

// Основная функция для проверки и покупки вардов
function checkAndBuyWards() {
	// Получаем локального героя правильным способом
	const hero = LocalPlayer?.Hero
	
	// Проверяем, что герой существует и жив
	if (hero && hero.IsValid && hero.IsAlive) {
		// Подсчитываем количество Observer Ward в инвентаре
		const wardsCount = countObserverWards(hero)
		
		console.log(`Текущее количество Observer Ward: ${wardsCount}`)
		
		// Если количество вардов меньше минимального, покупаем новые
		if (wardsCount < MIN_WARDS_COUNT) {
			buyObserverWard(hero)
		}
	}
}

// Переменная для отслеживания времени последней проверки
let lastCheckTime = 0

// Запускаем проверку при старте игры
EventsSDK.on("GameStarted", () => {
	console.log("Скрипт автоматической покупки Observer Ward запущен!")
	
	// Устанавливаем начальное время проверки
	lastCheckTime = GameState.RawGameTime
})

// Проверяем периодически
EventsSDK.on("Tick", () => {
	// Проверяем, находимся ли мы в игре
	if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
		return
	}
	
	// Проверяем, прошло ли достаточно времени с последней проверки
	const currentTime = GameState.RawGameTime
	
	// Проверяем каждые CHECK_INTERVAL секунд
	if (currentTime - lastCheckTime >= CHECK_INTERVAL) {
		checkAndBuyWards()
		lastCheckTime = currentTime
	}
})

// Также проверяем при возрождении героя
EventsSDK.on("UnitSpawned", unit => {
	// Проверяем, что это локальный герой
	if (unit === LocalPlayer?.Hero) {
		console.log("Герой возродился, проверяем наличие Observer Ward")
		checkAndBuyWards()
	}
})
