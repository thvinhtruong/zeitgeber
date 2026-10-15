import Cocoa
import Foundation

private struct TaskRecord: Decodable {
    let id: Int
    let title: String
    let status: String
    let recurrence: String
    let plannedFor: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, status, recurrence
        case plannedFor = "planned_for"
        case createdAt = "created_at"
    }
}

private struct Active: Decodable {
    let taskId: Int
    let startedAt: String

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case startedAt = "started_at"
    }
}

private struct TasksResponse: Decodable {
    let tasks: [TaskRecord]
    let active: Active?
}

final class MenuBarController: NSObject, NSApplicationDelegate {
    private let apiURL = URL(string: "http://vinhtruong.localhost/api/tasks")!
    private let appURL = URL(string: "http://vinhtruong.localhost")!
    private var statusItem: NSStatusItem!
    private var active: Active?
    private var tasks: [TaskRecord] = []
    private var runningTitle: String?
    private var refreshTimer: Timer?
    private var clockTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "--:--:--"
        statusItem.button?.toolTip = "Zeitgeber timer"
        statusItem.button?.font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        statusItem.button?.wantsLayer = true
        statusItem.button?.layer?.borderWidth = 2
        statusItem.button?.layer?.cornerRadius = 4
        statusItem.button?.layer?.borderColor = NSColor.white.withAlphaComponent(0.8).cgColor

        let menu = NSMenu()
        statusItem.menu = menu
        rebuildMenu()

        refresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.refresh()
        }
        clockTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.updateTitle()
        }
    }

    private func refresh() {
        URLSession.shared.dataTask(with: apiURL) { [weak self] data, _, _ in
            guard let data else {
                DispatchQueue.main.async { self?.showUnavailable() }
                return
            }

            do {
                let response = try JSONDecoder().decode(TasksResponse.self, from: data)
                DispatchQueue.main.async { self?.apply(response) }
            } catch {
                DispatchQueue.main.async { self?.showUnavailable() }
            }
        }.resume()
    }

    private func apply(_ response: TasksResponse) {
        tasks = response.tasks
        active = response.active
        runningTitle = response.active.flatMap { active in
            response.tasks.first(where: { $0.id == active.taskId })?.title
        }
        updateTitle()
        rebuildMenu()
    }

    private func showUnavailable() {
        active = nil
        runningTitle = nil
        tasks = []
        statusItem.button?.title = "--:--:--"
        statusItem.button?.toolTip = "Zeitgeber is unavailable at vinhtruong.localhost"
        rebuildMenu()
    }

    private func updateTitle() {
        guard let active else {
            statusItem.button?.title = "--:--:--"
            statusItem.button?.toolTip = "No timer running"
            return
        }

        let elapsed = max(0, Date().timeIntervalSince(parseUTC(active.startedAt)))
        statusItem.button?.title = format(elapsed)
        statusItem.button?.toolTip = runningTitle ?? "Running task"
    }

    private func rebuildMenu() {
        guard let menu = statusItem.menu else { return }
        menu.removeAllItems()

        let heading = NSMenuItem(title: "Today's tasks", action: nil, keyEquivalent: "")
        heading.isEnabled = false
        menu.addItem(heading)

        let todayTasks = tasks.filter(isTaskForToday)
        if todayTasks.isEmpty {
            let empty = NSMenuItem(title: "No open tasks", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
        } else {
            for task in todayTasks {
                let item = NSMenuItem(title: task.title, action: #selector(selectTask), keyEquivalent: "")
                item.target = self
                item.representedObject = task.id
                item.state = active?.taskId == task.id ? .on : .off
                menu.addItem(item)
            }
        }

        menu.addItem(.separator())
        let stop = NSMenuItem(title: "Stop timer", action: #selector(stopTimer), keyEquivalent: "")
        stop.target = self
        stop.isEnabled = active != nil
        menu.addItem(stop)
        menu.addItem(NSMenuItem.separator())

        let open = NSMenuItem(title: "Open Zeitgeber", action: #selector(openTracker), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        let quit = NSMenuItem(title: "Quit menu bar", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    private func isTaskForToday(_ task: TaskRecord) -> Bool {
        guard task.status != "done" else { return false }
        if task.plannedFor == localDayKey() { return true }
        guard task.status == "recurring" else { return false }
        if task.recurrence == "weekly" {
            return Calendar.current.component(.weekday, from: parseUTC(task.createdAt)) ==
                Calendar.current.component(.weekday, from: Date())
        }
        return true
    }

    private func localDayKey() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private func post(_ path: String, completion: @escaping () -> Void) {
        var request = URLRequest(url: URL(string: "http://vinhtruong.localhost\(path)")!)
        request.httpMethod = "POST"
        URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.async {
                completion()
                self?.refresh()
            }
        }.resume()
    }

    @objc private func selectTask(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? Int else { return }
        post("/api/tasks/\(id)/start") {}
    }

    @objc private func stopTimer() {
        post("/api/stop") {}
    }

    private func parseUTC(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value.replacingOccurrences(of: " ", with: "T") + ".000Z") {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value.replacingOccurrences(of: " ", with: "T") + "Z") ?? Date()
    }

    private func format(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        return String(format: "%02d:%02d:%02d", total / 3600, (total / 60) % 60, total % 60)
    }

    @objc private func openTracker() {
        NSWorkspace.shared.open(appURL)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = MenuBarController()
application.delegate = delegate
application.run()