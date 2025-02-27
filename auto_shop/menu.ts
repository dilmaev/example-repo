import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	// Основное меню
	public readonly State: Menu.Toggle
	public readonly CheckIntervalSlider: Menu.Slider
	
	// Переключатели для предметов
	public readonly ObserverWard: Menu.Toggle
	public readonly SentryWard: Menu.Toggle
	public readonly Smoke: Menu.Toggle
	
	private readonly baseNode = Menu.AddEntry("Utility")
	private readonly tree: Menu.Node

	constructor() {
		// Создаем узел меню для автопокупки
		this.tree = this.baseNode.AddNode("Auto shop", ImageData.Icons.shop)
		
		// Добавляем основной переключатель для включения/выключения скрипта
		this.State = this.tree.AddToggle("Включить автопокупку")
		
		// Добавляем слайдер для настройки интервала проверки
		// Используем формат слайдера как в примере (name, defaultValue, min, max)
		this.CheckIntervalSlider = this.tree.AddSlider(
			"Интервал проверки (0.1 - 5 сек)", 
			10,  // значение по умолчанию (1 секунда * 10)
			0.1,   // минимальное значение (0.1 секунды * 10)
			50   // максимальное значение (5 секунд * 10)
		)
		
		// Создаем узел для предметов
		const itemsNode = this.tree.AddNode("Предметы")
		
		// Добавляем переключатели для каждого предмета
		this.ObserverWard = itemsNode.AddToggle("Observer Ward")
		this.SentryWard = itemsNode.AddToggle("Sentry Ward")
		this.Smoke = itemsNode.AddToggle("Smoke of Deceit")
		
		// Устанавливаем значения по умолчанию
		this.ObserverWard.value = true
		this.SentryWard.value = true
		this.Smoke.value = false
	}
	
	// Получаем интервал проверки в секундах (конвертируем значение слайдера)
	public get CheckInterval(): number {
		// Преобразуем значение слайдера (1-50) в секунды (0.1-5)
		return this.CheckIntervalSlider.value / 10
	}
	
	// Метод для проверки, включен ли конкретный предмет
	public isItemEnabled(itemName: string): boolean {
		switch (itemName) {
			case "item_ward_observer":
				return this.ObserverWard.value
			case "item_ward_sentry":
				return this.SentryWard.value
			case "item_smoke_of_deceit":
				return this.Smoke.value
			default:
				return false
		}
	}
} 