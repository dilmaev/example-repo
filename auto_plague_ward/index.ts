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
	ImageData
} from "github.com/octarine-public/wrapper/index"

class MenuManager {
	public readonly State: Menu.Toggle
	
	private readonly baseNode = Menu.AddEntry("Utility")
	private readonly tree: Menu.Node

	constructor() {
		// Создаем узел меню для автоиспользования Plague Ward
		this.tree = this.baseNode.AddNode("Auto Plague Ward", ImageData.Icons.magic_resist)
		
		// Добавляем основной переключатель для включения/выключения скрипта
		this.State = this.tree.AddToggle("Включить автоварды")
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
	}
	
	// Проверяем, играет ли игрок за Веномансера
	private isPlayingVenomancer(): boolean {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			return false
		}
		
		// Проверяем имя героя
		return hero.Name === "npc_dota_hero_venomancer"
	}
	
	// Находим способность Plague Ward у героя
	private findPlaguaWardAbility(): any | undefined {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			return undefined
		}
		
		// Ищем способность в списке способностей героя
		for (const ability of hero.Abilities) {
			if (ability && ability.Name === this.ABILITY_NAME) {
				return ability
			}
		}
		
		return undefined
	}
	
	// Проверяем, можно ли использовать способность
	private canUseAbility(ability: any): boolean {
		if (!ability || ability.Level <= 0) {
			return false
		}
		
		// Проверяем, что способность не в кулдауне, есть мана и герой может кастовать
		return ability.IsReady && !ability.IsCasting && !this.sleeper.Sleeping("cast_ward")
	}
	
	// Использование способности на свою позицию
	private castPlaguaWard(): void {
		const hero = LocalPlayer?.Hero
		const ability = this.findPlaguaWardAbility()
		
		if (!hero || !ability || !this.canUseAbility(ability)) {
			return
		}
		
		// Получаем позицию героя
		const heroPosition = hero.Position
		if (!heroPosition) {
			return
		}
		
		// Выполняем каст способности на своей позиции
		TaskManager.Begin(() => {
			// Используем способность на свою позицию
			ability.UseAbilityPosition(heroPosition.Clone())
			
			// Устанавливаем слипер, чтобы не спамить попытками использования
			this.sleeper.Sleep(0.5 * 1000, "cast_ward")
		})
	}
	
	// Обработчик события начала игры
	private GameStarted() {
		this.lastCheckTime = GameState.RawGameTime
		this.sleeper.FullReset()
	}
	
	// Обработчик события окончания игры
	private GameEnded() {
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