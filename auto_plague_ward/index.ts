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
		
		console.log("AutoPlaceWard: Скрипт загружен")
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
			console.log(`Герой: ${hero.Name}, это Веномансер`)
		}
		return isVeno
	}
	
	// Находим способность Plague Ward у героя
	private findPlaguaWardAbility(): any | undefined {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			console.log("Герой недоступен")
			return undefined
		}
		
		// Проверяем, что Abilities существует
		if (!hero.Abilities) {
			console.log("hero.Abilities не определено")
			return undefined
		}
		
		// Выводим список всех способностей героя
		console.log(`Список способностей (всего ${hero.Abilities.length || 0}):`)
		
		// Проверяем, что массив способностей не пустой
		if (!hero.Abilities.length) {
			console.log("Массив способностей пуст")
			return undefined
		}
		
		// Перебираем все способности героя с дополнительной проверкой
		for (let i = 0; i < hero.Abilities.length; i++) {
			const ability = hero.Abilities[i]
			if (ability) {
				console.log(`Способность [${i}]: ${ability.Name}, уровень: ${ability.Level || 0}`)
			}
		}
		
		// Ищем способность в списке способностей героя
		for (const ability of hero.Abilities) {
			if (ability && ability.Name === this.ABILITY_NAME) {
				console.log(`Найдена способность ${this.ABILITY_NAME}`)
				return ability
			}
		}
		
		// Если не найдена, попробуем найти по подстроке
		for (const ability of hero.Abilities) {
			if (ability && ability.Name && ability.Name.includes("plague_ward")) {
				console.log(`Найдена способность по подстроке: ${ability.Name}`)
				return ability
			}
		}
		
		// Последняя попытка - ищем любую способность с "ward" в названии
		for (const ability of hero.Abilities) {
			if (ability && ability.Name && ability.Name.includes("ward")) {
				console.log(`Найдена способность с "ward" в названии: ${ability.Name}`)
				return ability
			}
		}
		
		console.log(`Способность ${this.ABILITY_NAME} не найдена`)
		return undefined
	}
	
	// Проверяем, можно ли использовать способность
	private canUseAbility(ability: any): boolean {
		if (!ability) {
			console.log("Способность не определена")
			return false
		}
		
		if (ability.Level <= 0) {
			console.log("Способность не изучена")
			return false
		}
		
		// Проверяем детальную информацию о способности
		console.log(`Способность: ${ability.Name}`)
		console.log(`IsReady: ${ability.IsReady}, IsCasting: ${ability.IsCasting || false}`)
		console.log(`Уровень: ${ability.Level}, Кулдаун: ${ability.CooldownTimeRemaining || 0}`)
		
		// Безопасная проверка маны
		const hero = LocalPlayer?.Hero
		const heroMana = hero ? hero.Mana : 0
		const manaCost = ability.ManaCost || 0
		console.log(`Мана героя: ${heroMana}, Требуется маны: ${manaCost}`)
		
		// Спит ли слипер
		const isSleeping = this.sleeper.Sleeping("cast_ward")
		console.log(`Слипер активен: ${isSleeping}`)
		
		// Проверяем, что способность не в кулдауне и есть мана
		return ability.IsReady && !(ability.IsCasting || false) && !isSleeping
	}
	
	// Использование способности на свою позицию
	private castPlaguaWard(): void {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			console.log("Герой недоступен для каста")
			return
		}
		
		// Получаем способность и проверяем вручную, без использования findPlaguaWardAbility
		try {
			console.log("Пробуем получить список способностей напрямую")
			if (!hero.Abilities) {
				console.log("hero.Abilities не определено при прямом доступе")
				return
			}
			
			console.log(`Прямой доступ: Abilities.length = ${hero.Abilities.length || 0}`)
		} catch (err) {
			console.log(`Ошибка при прямом доступе к способностям: ${err}`)
		}
		
		const ability = this.findPlaguaWardAbility()
		
		if (!ability) {
			console.log("Способность не найдена для каста")
			return
		}
		
		if (!this.canUseAbility(ability)) {
			console.log("Способность не готова к использованию")
			return
		}
		
		// Получаем позицию героя
		const heroPosition = hero.Position
		if (!heroPosition) {
			console.log("Позиция героя недоступна")
			return
		}
		
		console.log(`Пробую кастовать варда на позицию: ${heroPosition.x}, ${heroPosition.y}, ${heroPosition.z}`)
		
		// Выполняем каст способности на своей позиции
		try {
			// Используем TaskManager для надежного выполнения способности
			TaskManager.Begin(() => {
				// Проверяем еще раз перед выполнением
				if (!hero.IsValid || !ability || !heroPosition) {
					console.log("Условия изменились, отменяем каст")
					return
				}
				
				// Используем правильный метод для кастования на позицию - hero.CastPosition
				hero.CastPosition(ability, heroPosition.Clone())
				
				// Устанавливаем слипер, чтобы не спамить попытками использования
				this.sleeper.Sleep(0.5 * 1000, "cast_ward")
				
				console.log("Команда на каст отправлена")
			})
			
			console.log("Попытка каста выполнена успешно")
		} catch (error) {
			console.log(`Ошибка при касте: ${error}`)
		}
	}
	
	// Обработчик события начала игры
	private GameStarted() {
		console.log("AutoPlaceWard: Игра началась")
		this.lastCheckTime = GameState.RawGameTime
		this.sleeper.FullReset()
	}
	
	// Обработчик события окончания игры
	private GameEnded() {
		console.log("AutoPlaceWard: Игра закончилась")
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
		
		try {
			// Регулярная проверка каждые COOLDOWN_CHECK_INTERVAL секунд
			const currentTime = GameState.RawGameTime
			if (currentTime - this.lastCheckTime >= this.COOLDOWN_CHECK_INTERVAL) {
				this.castPlaguaWard()
				this.lastCheckTime = currentTime
			}
		} catch (error) {
			console.log(`Ошибка в методе Tick: ${error}`)
		}
	}
})() 