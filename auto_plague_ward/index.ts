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
	private readonly COOLDOWN_CHECK_INTERVAL = 0.5 // Увеличиваем интервал проверки до 0.5 секунды
	private readonly CAST_COOLDOWN = 1.0 // Минимальное время между кастами в секундах
	
	// Переменная для отслеживания времени последней проверки
	private lastCheckTime = 0
	
	// Переменная для отслеживания времени последнего успешного использования
	private lastCastTime = 0
	
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
	
	// Находим способность Plague Ward у героя по названию
	private findPlaguaWardAbility(): any | undefined {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			console.log("Герой недоступен")
			return undefined
		}
		
		try {
			// Используем правильный метод GetAbilityByName из API
			const ability = hero.GetAbilityByName(this.ABILITY_NAME)
			if (ability) {
				console.log(`Найдена способность ${this.ABILITY_NAME}`)
				return ability
			}
			
			// Если не найдена, ищем по регулярному выражению
			const regexAbility = hero.GetAbilityByName(/plague_ward/)
			if (regexAbility) {
				console.log(`Найдена способность по регулярному выражению: ${regexAbility.Name}`)
				return regexAbility
			}
			
			// Для отладки выведем все способности героя
			console.log("Список всех способностей героя:")
			if (hero.Spells) {
				for (const spell of hero.Spells) {
					if (spell) {
						console.log(`- ${spell.Name}, уровень: ${spell.Level}`)
					}
				}
			} else {
				console.log("hero.Spells не определено")
			}
			
			console.log(`Способность ${this.ABILITY_NAME} не найдена`)
			return undefined
		} catch (error) {
			console.log(`Ошибка при поиске способности: ${error}`)
			return undefined
		}
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
		
		// Проверяем время с последнего успешного использования
		const timeSinceLastCast = GameState.RawGameTime - this.lastCastTime
		console.log(`Время с последнего использования: ${timeSinceLastCast.toFixed(2)} сек.`)
		
		// Дополнительная проверка на кулдаун для надежности
		const isOnCooldown = ability.CooldownTimeRemaining > 0 || !ability.IsReady || timeSinceLastCast < this.CAST_COOLDOWN
		
		if (isOnCooldown) {
			console.log(`Способность еще в кулдауне или недавно использовалась (${timeSinceLastCast.toFixed(2)} < ${this.CAST_COOLDOWN} сек.)`)
			return false
		}
		
		// Проверяем, что способность готова, не в кулдауне, есть мана и прошло достаточно времени с последнего каста
		return ability.IsReady && !(ability.IsCasting || false) && !isSleeping && 
		       heroMana >= manaCost && timeSinceLastCast >= this.CAST_COOLDOWN;
	}
	
	// Использование способности на самого себя (героя)
	private castPlaguaWard(): void {
		try {
			const hero = LocalPlayer?.Hero
			if (!hero || !hero.IsValid) {
				console.log("Герой недоступен для каста")
				return
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
			
			// Используем TaskManager для надежного выполнения способности
			TaskManager.Begin(() => {
				// Проверяем еще раз перед выполнением
				if (!hero.IsValid || !ability) {
					console.log("Условия изменились, отменяем каст")
					return
				}
				
				// Дополнительная проверка готовности
				if (!ability.IsReady || ability.CooldownTimeRemaining > 0) {
					console.log("Способность внезапно оказалась не готова, отменяем каст")
					return
				}
				
				// Определяем тип способности и используем соответствующий метод каста
				console.log("Кастуем ward на героя")
				
				// Используем CastTarget для кастования на самого героя
				hero.CastTarget(ability, hero)
				
				// Устанавливаем слипер на более длительное время
				this.sleeper.Sleep(1.0 * 1000, "cast_ward")
				
				// Обновляем время последнего каста
				this.lastCastTime = GameState.RawGameTime
				
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
		this.lastCastTime = GameState.RawGameTime - this.CAST_COOLDOWN // Позволяем сразу использовать способность
		this.sleeper.FullReset()
	}
	
	// Обработчик события окончания игры
	private GameEnded() {
		console.log("AutoPlaceWard: Игра закончилась")
		this.sleeper.FullReset()
	}
	
	// Обработчик тика игры
	private Tick() {
		try {
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
		} catch (error) {
			console.log(`Ошибка в методе Tick: ${error}`)
		}
	}
})() 