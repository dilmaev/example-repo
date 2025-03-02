import {
	EventsSDK,
	GameState,
	Unit,
	LocalPlayer,
	DOTAGameUIState,
	TaskManager,
	GameRules,
	AbilityData,
	Sleeper,
	Menu,
	Vector3,
	ImageData,
	Log
} from "github.com/octarine-public/wrapper/index"

class MenuManager {
	public readonly State: Menu.Toggle
	
	private readonly baseNode = Menu.AddEntry("Utility")
	private readonly tree: Menu.Node

	constructor() {
		// Создаем узел меню для автоиспользования Plague Ward
		this.tree = this.baseNode.AddNode("Auto Plague Ward", ImageData.Icons.magic_resist)
		
		// Добавляем основной переключатель для включения/выключения скрипта
		this.State = this.tree.AddToggle("Включить автоварды", true)
	}
}

new (class AutoPlaceWard {
	// Постоянные значения для скрипта
	private readonly ABILITY_NAME = "venomancer_plague_ward"
	private readonly COOLDOWN_CHECK_INTERVAL = 0.1 // Секунды
	
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
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
		
		Log.Info("AutoPlaceWard: Скрипт загружен")
	}
	
	// Проверяем, играет ли игрок за Веномансера
	private isPlayingVenomancer(): boolean {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			return false
		}
		
		// Проверяем имя героя
		const isVeno = hero.Name === "npc_dota_hero_venomancer"
		if (isVeno) {
			Log.Info(`Герой: ${hero.Name}, это Веномансер`)
		}
		return isVeno
	}
	
	// Находим способность Plague Ward у героя
	private findPlaguaWardAbility(): any | undefined {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			Log.Info("Герой недоступен")
			return undefined
		}
		
		// Выводим список всех способностей героя
		Log.Info(`Список способностей (всего ${hero.Abilities.length}):`)
		for (const ability of hero.Abilities) {
			if (ability) {
				Log.Info(`Способность: ${ability.Name}, уровень: ${ability.Level}`)
			}
		}
		
		// Ищем способность в списке способностей героя
		for (const ability of hero.Abilities) {
			if (ability && ability.Name === this.ABILITY_NAME) {
				Log.Info(`Найдена способность ${this.ABILITY_NAME}`)
				return ability
			}
		}
		
		// Если не найдена, попробуем найти по подстроке
		for (const ability of hero.Abilities) {
			if (ability && ability.Name.includes("plague_ward")) {
				Log.Info(`Найдена способность по подстроке: ${ability.Name}`)
				return ability
			}
		}
		
		Log.Info(`Способность ${this.ABILITY_NAME} не найдена`)
		return undefined
	}
	
	// Проверяем, можно ли использовать способность
	private canUseAbility(ability: any): boolean {
		if (!ability || ability.Level <= 0) {
			Log.Info("Способность не найдена или не изучена")
			return false
		}
		
		// Проверяем детальную информацию о способности
		Log.Info(`Способность: ${ability.Name}`)
		Log.Info(`IsReady: ${ability.IsReady}, IsCasting: ${ability.IsCasting}`)
		Log.Info(`Уровень: ${ability.Level}, Кулдаун: ${ability.CooldownTimeRemaining}`)
		Log.Info(`Мана героя: ${LocalPlayer?.Hero?.Mana}, Требуется маны: ${ability.ManaCost}`)
		
		// Спит ли слипер
		const isSleeping = this.sleeper.Sleeping("cast_ward")
		Log.Info(`Слипер активен: ${isSleeping}`)
		
		// Проверяем, что способность не в кулдауне, есть мана и герой может кастовать
		return ability.IsReady && !ability.IsCasting && !isSleeping
	}
	
	// Использование способности на свою позицию
	private castPlaguaWard(): void {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			Log.Info("Герой недоступен для каста")
			return
		}
		
		const ability = this.findPlaguaWardAbility()
		
		if (!ability) {
			Log.Info("Способность не найдена для каста")
			return
		}
		
		if (!this.canUseAbility(ability)) {
			Log.Info("Способность не готова к использованию")
			return
		}
		
		// Получаем позицию героя
		const heroPosition = hero.Position
		if (!heroPosition) {
			Log.Info("Позиция героя недоступна")
			return
		}
		
		Log.Info(`Пробую кастовать варда на позицию: ${heroPosition.x}, ${heroPosition.y}, ${heroPosition.z}`)
		
		// Выполняем каст способности на своей позиции
		try {
			// Используем способность на свою позицию
			ability.UseAbilityPosition(heroPosition.Clone())
			
			// Устанавливаем слипер, чтобы не спамить попытками использования
			this.sleeper.Sleep(0.5 * 1000, "cast_ward")
			
			Log.Info("Попытка каста выполнена успешно")
		} catch (error) {
			Log.Info(`Ошибка при касте: ${error}`)
		}
	}
	
	// Обработчик события начала игры
	private GameStarted() {
		Log.Info("AutoPlaceWard: Игра началась")
		this.lastCheckTime = GameState.RawGameTime
		this.sleeper.FullReset()
	}
	
	// Обработчик события окончания игры
	private GameEnded() {
		Log.Info("AutoPlaceWard: Игра закончилась")
		this.sleeper.FullReset()
	}
	
	// Обработчик тика игры
	private Tick() {
		// Проверяем, находимся ли мы в игре
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return
		}
		
		// Если скрипт выключен в меню, прекращаем выполнение
		if (!this.menu.State.value) {
			return
		}
		
		// Если игрок не играет за Веномансера, выходим
		if (!this.isPlayingVenomancer()) {
			return
		}
		
		// Регулярная проверка каждые COOLDOWN_CHECK_INTERVAL секунд
		const currentTime = GameState.RawGameTime
		if (currentTime - this.lastCheckTime >= this.COOLDOWN_CHECK_INTERVAL) {
			this.castPlaguaWard()
			this.lastCheckTime = currentTime
		}
	}
})() 