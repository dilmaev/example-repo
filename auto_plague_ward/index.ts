/*
 * Автоматическое использование способности Plague Ward для Веномансера
 * Возможности:
 * - Автоматически применяет способность Plague Ward, когда она готова
 * - Проверяет наличие достаточного количества маны
 * - НЕ использует способность, если герой находится в состоянии невидимости
 * - Соблюдает минимальный интервал между применениями способности
 * - Можно включить/выключить в меню
 * - Размещает вард в позиции курсора мыши
 */

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
	InputManager
} from "github.com/octarine-public/wrapper/index"

class MenuManager {
	public readonly State: Menu.Toggle
	public readonly UseAtCursor: Menu.Toggle
	
	private readonly baseNode = Menu.AddEntry("Utility")
	private readonly tree: Menu.Node

	constructor() {
		// Создаем узел меню для автоиспользования Plague Ward
		this.tree = this.baseNode.AddNode("Auto Plague Ward", ImageData.Icons.magic_resist)
		
		// Добавляем основной переключатель для включения/выключения скрипта
		this.State = this.tree.AddToggle("Включить автоварды", true)
		
		// Добавляем переключатель для размещения варда в позиции курсора
		this.UseAtCursor = this.tree.AddToggle("Ставить вард на курсор", true)
	}
}

new (class AutoPlaceWard {
	// Постоянные значения для скрипта
	private readonly ABILITY_NAME = "venomancer_plague_ward"
	private readonly COOLDOWN_CHECK_INTERVAL = 0.5 // Интервал проверки в секундах
	private readonly CAST_COOLDOWN = 0.5 // Минимальное время между кастами в секундах
	
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
		
		this.log("AutoPlaceWard: Скрипт загружен")
	}
	
	// Функция в которой можно будет включать и выключать логи одной кнопкой
	private log(...args: any[]) {
		var enabled = false
		if (enabled) {
			console.log(...args)
		}
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
			this.log(`Герой: ${hero.Name}, это Веномансер`)
		}
		return isVeno
	}
	
	// Находим способность Plague Ward у героя по названию
	private findPlaguaWardAbility(): any | undefined {
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			this.log("Герой недоступен")
			return undefined
		}
		
		try {
			// Используем правильный метод GetAbilityByName из API
			const ability = hero.GetAbilityByName(this.ABILITY_NAME)
			if (ability) {
				this.log(`Найдена способность ${this.ABILITY_NAME}`)
				return ability
			}
			
			// Если не найдена, ищем по регулярному выражению
			const regexAbility = hero.GetAbilityByName(/plague_ward/)
			if (regexAbility) {
				this.log(`Найдена способность по регулярному выражению: ${regexAbility.Name}`)
				return regexAbility
			}
			
			// Для отладки выведем все способности героя
			this.log("Список всех способностей героя:")
			if (hero.Spells) {
				for (const spell of hero.Spells) {
					if (spell) {
						this.log(`- ${spell.Name}, уровень: ${spell.Level}`)
					}
				}
			} else {
				this.log("hero.Spells не определено")
			}
			
			this.log(`Способность ${this.ABILITY_NAME} не найдена`)
			return undefined
		} catch (error) {
			this.log(`Ошибка при поиске способности: ${error}`)
			return undefined
		}
	}
	
	// Проверяем, можно ли использовать способность
	private canUseAbility(ability: any): boolean {
		if (!ability) {
			this.log("Способность не определена")
			return false
		}
		
		if (ability.Level <= 0) {
			this.log("Способность не изучена")
			return false
		}
		
		// Проверяем детальную информацию о способности
		this.log(`Способность: ${ability.Name}`)
		this.log(`IsReady: ${ability.IsReady}, IsCasting: ${ability.IsCasting || false}`)
		this.log(`Уровень: ${ability.Level}, Кулдаун: ${ability.CooldownTimeRemaining || 0}`)
		
		// Безопасная проверка маны
		const hero = LocalPlayer?.Hero
		const heroMana = hero ? hero.Mana : 0
		const manaCost = ability.ManaCost || 0
		this.log(`Мана героя: ${heroMana}, Требуется маны: ${manaCost}`)
		
		// Проверяем невидимость героя
		const isInvisible = hero ? hero.IsInvisible : false
		this.log(`Герой невидим: ${isInvisible}`)
		
		// Если герой невидим, не используем способность
		if (isInvisible) {
			this.log("Герой невидим, пропускаем использование способности")
			return false
		}
		
		// Спит ли слипер
		const isSleeping = this.sleeper.Sleeping("cast_ward")
		this.log(`Слипер активен: ${isSleeping}`)
		
		// Проверяем время с последнего успешного использования
		const timeSinceLastCast = GameState.RawGameTime - this.lastCastTime
		this.log(`Время с последнего использования: ${timeSinceLastCast.toFixed(2)} сек.`)
		
		// Дополнительная проверка на кулдаун для надежности
		const isOnCooldown = ability.CooldownTimeRemaining > 0 || !ability.IsReady || timeSinceLastCast < this.CAST_COOLDOWN
		
		if (isOnCooldown) {
			this.log(`Способность еще в кулдауне или недавно использовалась (${timeSinceLastCast.toFixed(2)} < ${this.CAST_COOLDOWN} сек.)`)
			return false
		}
		
		// Проверяем, что способность готова, не в кулдауне, есть мана и прошло достаточно времени с последнего каста
		return ability.IsReady && !(ability.IsCasting || false) && !isSleeping && 
		       heroMana >= manaCost && timeSinceLastCast >= this.CAST_COOLDOWN;
	}
	
	// Получение текущей позиции курсора мыши в мировых координатах
	private getCursorPosition(): Vector3 | undefined {
		try {
			// Получаем позицию курсора из InputManager
			const cursorPos = InputManager.CursorOnWorld
			if (cursorPos && cursorPos.IsValid) {
				return cursorPos.Clone()
			}
			
			// Если не удалось получить, возвращаем undefined
			this.log("Не удалось получить позицию курсора")
			return undefined
		} catch (error) {
			this.log(`Ошибка при получении позиции курсора: ${error}`)
			return undefined
		}
	}
	
	// Использование способности
	private castPlaguaWard(): void {
		try {
			const hero = LocalPlayer?.Hero
			if (!hero || !hero.IsValid) {
				this.log("Герой недоступен для каста")
				return
			}
			
			const ability = this.findPlaguaWardAbility()
			
			if (!ability) {
				this.log("Способность не найдена для каста")
				return
			}
			
			if (!this.canUseAbility(ability)) {
				this.log("Способность не готова к использованию")
				return
			}
			
			// Используем TaskManager для надежного выполнения способности
			TaskManager.Begin(() => {
				// Проверяем еще раз перед выполнением
				if (!hero.IsValid || !ability) {
					this.log("Условия изменились, отменяем каст")
					return
				}
				
				// Дополнительная проверка готовности
				if (!ability.IsReady || ability.CooldownTimeRemaining > 0) {
					this.log("Способность внезапно оказалась не готова, отменяем каст")
					return
				}
				
				// Определяем, куда кастовать вард
				if (this.menu.UseAtCursor.value) {
					// Получаем позицию курсора
					const cursorPos = this.getCursorPosition()
					if (cursorPos) {
						// Используем CastPosition для кастования в точку курсора
						this.log(`Кастуем ward на позицию курсора: ${cursorPos.toString()}`)
						hero.CastPosition(ability, cursorPos)
						this.log("Команда на каст отправлена в позицию курсора")
					} else {
						// Если не удалось получить позицию курсора, кастуем на героя
						this.log("Не удалось получить позицию курсора, кастуем на героя")
						hero.CastTarget(ability, hero)
						this.log("Команда на каст отправлена на героя")
					}
				} else {
					// Кастуем на героя, если опция выключена
					this.log("Кастуем ward на героя")
					hero.CastTarget(ability, hero)
					this.log("Команда на каст отправлена на героя")
				}
				
				// Устанавливаем слипер на более длительное время
				this.sleeper.Sleep(1.0 * 1000, "cast_ward")
				
				// Обновляем время последнего каста
				this.lastCastTime = GameState.RawGameTime
			})
			
			this.log("Попытка каста выполнена успешно")
		} catch (error) {
			this.log(`Ошибка при касте: ${error}`)
		}
	}
	
	// Обработчик события начала игры
	private GameStarted() {
		this.log("AutoPlaceWard: Игра началась")
		this.lastCheckTime = GameState.RawGameTime
		this.lastCastTime = GameState.RawGameTime - this.CAST_COOLDOWN // Позволяем сразу использовать способность
		this.sleeper.FullReset()
	}
	
	// Обработчик события окончания игры
	private GameEnded() {
		this.log("AutoPlaceWard: Игра закончилась")
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
			this.log(`Ошибка в методе Tick: ${error}`)
		}
	}
})() 