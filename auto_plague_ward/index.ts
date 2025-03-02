/*
 * Автоматическое использование способности Plague Ward для Веномансера
 * Возможности:
 * - Автоматически применяет способность Plague Ward, когда она готова
 * - Проверяет наличие достаточного количества маны
 * - НЕ использует способность, если герой находится в состоянии невидимости
 * - Соблюдает минимальный интервал между применениями способности
 * - Можно включить/выключить в меню
 * - Продолжает выполнять последний приказ игрока после размещения варда
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
	ExecuteOrder,
	dotaunitorder_t,
	Entity
} from "github.com/octarine-public/wrapper/index"

class MenuManager {
	public readonly State: Menu.Toggle
	public readonly ResumeLastOrder: Menu.Toggle
	
	private readonly baseNode = Menu.AddEntry("Utility")
	private readonly tree: Menu.Node

	constructor() {
		// Создаем узел меню для автоиспользования Plague Ward
		this.tree = this.baseNode.AddNode("Auto Plague Ward", ImageData.Icons.magic_resist)
		
		// Добавляем основной переключатель для включения/выключения скрипта
		this.State = this.tree.AddToggle("Включить автоварды", true)
		
		// Добавляем переключатель для продолжения последнего приказа
		this.ResumeLastOrder = this.tree.AddToggle("Продолжать последний приказ", true)
	}
}

new (class AutoPlaceWard {
	// Постоянные значения для скрипта
	private readonly ABILITY_NAME = "venomancer_plague_ward"
	private readonly COOLDOWN_CHECK_INTERVAL = 0.5 // Увеличиваем интервал проверки до 0.5 секунды
	private readonly CAST_COOLDOWN = 1.0 // Минимальное время между кастами в секундах
	private readonly MAX_ORDER_AGE = 10.0 // Максимальное время в секундах, в течение которого приказ считается актуальным
	
	// Переменная для отслеживания времени последней проверки
	private lastCheckTime = 0
	
	// Переменная для отслеживания времени последнего успешного использования
	private lastCastTime = 0
	
	// Объект для ограничения частоты операций
	private readonly sleeper = new Sleeper()
	
	// Объект меню
	private readonly menu = new MenuManager()
	
	// Переменные для отслеживания последнего приказа игрока
	private lastOrderType?: dotaunitorder_t
	private lastOrderPosition?: Vector3
	private lastOrderTarget?: Entity
	private lastOrderAbility?: any
	private lastOrderQueue: boolean = false
	private lastOrderTime: number = 0
	private isOrderRestoreInProgress: boolean = false
	
	// Резервная копия последнего приказа для безопасности
	private savedOrderType?: dotaunitorder_t
	private savedOrderPosition?: Vector3
	private savedOrderTarget?: Entity
	private savedOrderAbility?: any
	private savedOrderQueue: boolean = false
	private savedOrderTime: number = 0
	
	constructor() {
		// Подписываемся на события
		EventsSDK.on("GameStarted", this.GameStarted.bind(this))
		EventsSDK.on("Tick", this.Tick.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
		
		// Подписываемся на события приказов игрока
		EventsSDK.on("ExecuteOrder", this.OnPlayerOrder.bind(this))
		
		this.log("AutoPlaceWard: Скрипт загружен")
	}

	// функция в которой можно будет включать и выключать логи одной кнопкой
	private log(...args: any[]) {
		var enabled = true // Временно включаем логи для отладки
		if (enabled) {
			console.log(...args)
		}
	}
	
	// Обработчик события исполнения приказа игрока
	private OnPlayerOrder(order: ExecuteOrder) {
		// Проверяем, что приказ отдаёт игрок, а не скрипт
		if (!order.IsPlayerInput) {
			return
		}
		
		const hero = LocalPlayer?.Hero
		if (!hero || !hero.IsValid) {
			return
		}
		
		// Игнорируем приказы, отданные не нашему герою
		if (!order.Issuers.includes(hero)) {
			return
		}
		
		// Если сейчас идет процесс восстановления приказа, игнорируем его сохранение
		if (this.isOrderRestoreInProgress) {
			this.log("Игнорируем сохранение приказа - идет процесс восстановления")
			return
		}
		
		// Игнорируем специфические команды, которые не стоит восстанавливать
		switch (order.OrderType) {
			case dotaunitorder_t.DOTA_UNIT_ORDER_PURCHASE_ITEM:
			case dotaunitorder_t.DOTA_UNIT_ORDER_SELL_ITEM:
			case dotaunitorder_t.DOTA_UNIT_ORDER_CAST_TOGGLE:
			case dotaunitorder_t.DOTA_UNIT_ORDER_CAST_TOGGLE_AUTO:
			case dotaunitorder_t.DOTA_UNIT_ORDER_STOP:
			case dotaunitorder_t.DOTA_UNIT_ORDER_HOLD_POSITION:
				return
		}
		
		// Игнорируем приказы каста Plague Ward, чтобы избежать циклов
		if (order.Ability_?.Name === this.ABILITY_NAME) {
			this.log(`Игнорируем приказ каста способности ${this.ABILITY_NAME}`)
			return
		}
		
		// Сохраняем информацию о приказе
		this.lastOrderType = order.OrderType
		this.lastOrderPosition = order.Position ? order.Position.Clone() : undefined
		this.lastOrderTarget = order.Target ? order.Target : undefined
		this.lastOrderAbility = order.Ability_
		this.lastOrderQueue = order.Queue
		this.lastOrderTime = GameState.RawGameTime
		
		// Создаем резервную копию приказа
		this.savedOrderType = order.OrderType
		this.savedOrderPosition = order.Position ? order.Position.Clone() : undefined
		this.savedOrderTarget = order.Target ? order.Target : undefined
		this.savedOrderAbility = order.Ability_
		this.savedOrderQueue = order.Queue
		this.savedOrderTime = GameState.RawGameTime
		
		this.log(`Сохранен приказ: ${this.lastOrderType}, позиция: ${this.lastOrderPosition}, цель: ${this.lastOrderTarget?.Name || 'нет'}`)
	}
	
	// Выполнение последнего приказа игрока
	private resumeLastOrder(): void {
		try {
			this.isOrderRestoreInProgress = true
			
			const hero = LocalPlayer?.Hero
			if (!hero || !hero.IsValid) {
				this.log("Не удалось восстановить приказ: герой недоступен")
				this.isOrderRestoreInProgress = false
				return
			}
			
			// Проверяем, есть ли сохраненный приказ
			if (!this.lastOrderType) {
				// Если основной приказ потерян, пробуем использовать резервную копию
				if (this.savedOrderType) {
					this.log("Основной приказ потерян, восстанавливаем из резервной копии")
					this.lastOrderType = this.savedOrderType
					this.lastOrderPosition = this.savedOrderPosition
					this.lastOrderTarget = this.savedOrderTarget
					this.lastOrderAbility = this.savedOrderAbility
					this.lastOrderQueue = this.savedOrderQueue
					this.lastOrderTime = this.savedOrderTime
				} else {
					this.log("Не удалось восстановить приказ: нет сохраненного приказа")
					this.isOrderRestoreInProgress = false
					return
				}
			}
			
			// Проверяем, включена ли опция в меню
			if (!this.menu.ResumeLastOrder.value) {
				this.log("Восстановление последнего приказа отключено в меню")
				this.isOrderRestoreInProgress = false
				return
			}
			
			// Проверяем актуальность приказа
			const orderAge = GameState.RawGameTime - this.lastOrderTime
			if (orderAge > this.MAX_ORDER_AGE) {
				this.log(`Приказ слишком старый (${orderAge.toFixed(2)} сек.), не восстанавливаем`)
				this.isOrderRestoreInProgress = false
				return
			}
			
			// Проверяем актуальность цели (если это юнит/объект)
			if (this.lastOrderTarget instanceof Entity) {
				if (!this.lastOrderTarget.IsValid || !this.lastOrderTarget.IsAlive || !this.lastOrderTarget.IsVisible) {
					this.log(`Цель приказа (${this.lastOrderTarget.Name}) недействительна, мертва или невидима`)
					this.isOrderRestoreInProgress = false
					return
				}
			}
			
			this.log(`Восстанавливаем последний приказ: ${this.lastOrderType}, возраст: ${orderAge.toFixed(2)} сек.`)
			
			// Восстанавливаем приказ в зависимости от его типа
			switch (this.lastOrderType) {
				case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_POSITION:
				case dotaunitorder_t.DOTA_UNIT_ORDER_ATTACK_MOVE:
					if (this.lastOrderPosition) {
						if (this.lastOrderType === dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_POSITION) {
							this.log(`Выполняем MoveTo на позицию: ${this.lastOrderPosition.toString()}`)
							hero.MoveTo(this.lastOrderPosition, this.lastOrderQueue)
							this.log(`Восстановлен приказ движения на позицию: ${this.lastOrderPosition.toString()}`)
						} else {
							this.log(`Выполняем AttackMove на позицию: ${this.lastOrderPosition.toString()}`)
							hero.AttackMove(this.lastOrderPosition, this.lastOrderQueue)
							this.log(`Восстановлен приказ атаки движением на позицию: ${this.lastOrderPosition.toString()}`)
						}
					}
					break;
				
				case dotaunitorder_t.DOTA_UNIT_ORDER_ATTACK_TARGET:
					if (this.lastOrderTarget instanceof Entity) {
						this.log(`Выполняем AttackTarget на цель: ${this.lastOrderTarget.Name}`)
						hero.AttackTarget(this.lastOrderTarget, this.lastOrderQueue)
						this.log(`Восстановлен приказ атаки цели: ${this.lastOrderTarget.Name}`)
					}
					break;
				
				case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_TARGET:
					if (this.lastOrderTarget instanceof Entity) {
						this.log(`Выполняем MoveToTarget на цель: ${this.lastOrderTarget.Name}`)
						hero.MoveToTarget(this.lastOrderTarget, this.lastOrderQueue)
						this.log(`Восстановлен приказ движения к цели: ${this.lastOrderTarget.Name}`)
					}
					break;
					
				default:
					this.log(`Приказ типа ${this.lastOrderType} не поддерживается для восстановления`)
					break;
			}
		} catch (error) {
			this.log(`Ошибка при восстановлении приказа: ${error}`)
		} finally {
			this.isOrderRestoreInProgress = false
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
	
	// Использование способности на самого себя (героя)
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
			
			// Создаем локальную копию текущего приказа прямо перед кастом
			const backupOrderType = this.lastOrderType
			const backupOrderPosition = this.lastOrderPosition ? this.lastOrderPosition.Clone() : undefined
			const backupOrderTarget = this.lastOrderTarget
			const backupOrderAbility = this.lastOrderAbility
			const backupOrderQueue = this.lastOrderQueue
			const backupOrderTime = this.lastOrderTime
			
			this.log(`Сохранена локальная копия приказа перед кастом: ${backupOrderType}`)
			
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
				
				// Определяем тип способности и используем соответствующий метод каста
				this.log("Кастуем ward на героя")
				
				// Используем CastTarget для кастования на самого героя
				hero.CastTarget(ability, hero)
				
				// Устанавливаем слипер на более длительное время
				this.sleeper.Sleep(1.0 * 1000, "cast_ward")
				
				// Обновляем время последнего каста
				this.lastCastTime = GameState.RawGameTime
				
				this.log("Команда на каст отправлена")
				
				// Восстанавливаем приказ из локальной копии, на случай если он был сброшен кастом
				if (!this.lastOrderType && backupOrderType) {
					this.log("Восстанавливаем приказ из локальной копии")
					this.lastOrderType = backupOrderType
					this.lastOrderPosition = backupOrderPosition
					this.lastOrderTarget = backupOrderTarget
					this.lastOrderAbility = backupOrderAbility
					this.lastOrderQueue = backupOrderQueue
					this.lastOrderTime = backupOrderTime
				}
				
				// Восстанавливаем последний приказ игрока через небольшую задержку
				TaskManager.Begin(() => {
					this.log("Первая попытка восстановления приказа через 500мс")
					this.log(`Текущий приказ: ${this.lastOrderType || 'не установлен'}`)
					this.resumeLastOrder()
				}, 500)  // Первая попытка через 500мс
				
				// Второй вызов с большим интервалом для надежности
				TaskManager.Begin(() => {
					this.log("Вторая попытка восстановления приказа через 1000мс")
					this.log(`Текущий приказ: ${this.lastOrderType || 'не установлен'}`)
					this.resumeLastOrder()
				}, 1000)  // Вторая попытка через 1000мс (1 секунда)
				
				// Третья попытка с еще большей задержкой для надежности
				TaskManager.Begin(() => {
					this.log("Третья попытка восстановления приказа через 1500мс")
					this.log(`Текущий приказ: ${this.lastOrderType || 'не установлен'}`)
					this.resumeLastOrder()
				}, 1500)  // Третья попытка через 1500мс
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