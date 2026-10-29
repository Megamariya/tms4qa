import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { todosApi, requirementsApi, type TodoItem, type Requirement } from "../api/client";
import { useToast } from "../components/Toast";
import "./TodoPage.css";

// ── Author / Assignee via localStorage ───────────────────────────────────────

interface AppUserBrief { id: string; name: string; }
function loadAppUsers(): AppUserBrief[] {
  try {
    const raw = localStorage.getItem("global_app_users");
    if (raw) return JSON.parse(raw).map((u: AppUserBrief) => ({ id: u.id, name: u.name }));
  } catch { /* */ }
  return [{ id: "6ca400f6-a755-4198-b398-5e2e6b79ee81", name: "Demo User" }];
}
const CURRENT_USER = "Demo User";
function getTodoAuthor(id: string): string { return localStorage.getItem(`todo_author_${id}`) ?? CURRENT_USER; }
function setTodoAuthor(id: string, name: string) { localStorage.setItem(`todo_author_${id}`, name); }
function getTodoAssignee(id: string): string | null { return localStorage.getItem(`todo_assignee_${id}`); }
function setTodoAssignee(id: string, name: string | null) {
  if (name) localStorage.setItem(`todo_assignee_${id}`, name);
  else localStorage.removeItem(`todo_assignee_${id}`);
}

type TodoStatus = "todo" | "in_progress" | "done";
type TodoPriority = "high" | "medium" | "low";

const STATUS_META: Record<TodoStatus, { label: string; color: string; bg: string }> = {
  todo:        { label: "To Do",       color: "#6b7280", bg: "#f3f4f6" },
  in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#dbeafe" },
  done:        { label: "Done",        color: "#065f46", bg: "#d1fae5" },
};
const PRIORITY_META: Record<TodoPriority, { label: string; color: string }> = {
  high:   { label: "High",   color: "#dc2626" },
  medium: { label: "Medium", color: "#ca8a04" },
  low:    { label: "Low",    color: "#6b7280" },
};
const TYPE_META: Record<TodoItem["type"], { label: string; icon: string }> = {
  task: { label: "Task",  icon: "☑" },
  note: { label: "Note",  icon: "📝" },
  plan: { label: "Plan",  icon: "📅" },
};

type TabType = "all" | TodoItem["type"];
type SortField = "created_at" | "due_date" | "priority" | "status";

export default function TodoPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId!;
  const toast = useToast();

  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<TodoStatus[]>([]);
  const [filterPriority, setFilterPriority] = useState<TodoPriority[]>([]);
  const [filterAssignee, setFilterAssignee] = useState<string>("");
  const [filterAuthor, setFilterAuthor] = useState<string>("");
  const [appUsers] = useState<AppUserBrief[]>(loadAppUsers);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TodoItem | null>(null);
  const [detailItem, setDetailItem] = useState<TodoItem | null>(null);

  const reload = () => {
    if (!pid) return;
    setLoading(true);
    todosApi.list(pid)
      .then((its) => {
        for (const it of its) {
          if (!localStorage.getItem(`todo_author_${it.id}`)) setTodoAuthor(it.id, CURRENT_USER);
        }
        setItems(its);
      })
      .catch(() => toast.error("Failed to load todos"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    requirementsApi.list(pid).then(setRequirements).catch(() => {});
  }, [pid]);

  const filtered = useMemo(() => {
    let result = items;
    if (activeTab !== "all") result = result.filter((i) => i.type === activeTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        (i.body ?? "").toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (filterStatus.length > 0) result = result.filter((i) => filterStatus.includes(i.status as TodoStatus));
    if (filterPriority.length > 0) result = result.filter((i) => filterPriority.includes(i.priority as TodoPriority));
    if (filterAssignee) result = result.filter((i) => getTodoAssignee(i.id) === filterAssignee);
    if (filterAuthor) result = result.filter((i) => getTodoAuthor(i.id) === filterAuthor);
    return [...result].sort((a, b) => {
      let va = "", vb = "";
      if (sortField === "created_at") { va = a.created_at; vb = b.created_at; }
      else if (sortField === "due_date") { va = a.due_date ?? "9999"; vb = b.due_date ?? "9999"; }
      else if (sortField === "priority") { const o: Record<string, number> = { high: 0, medium: 1, low: 2 }; va = String(o[a.priority] ?? 9); vb = String(o[b.priority] ?? 9); }
      else if (sortField === "status") { const o: Record<string, number> = { todo: 0, in_progress: 1, done: 2 }; va = String(o[a.status] ?? 9); vb = String(o[b.status] ?? 9); }
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [items, activeTab, search, filterStatus, filterPriority, filterAssignee, filterAuthor, sortField, sortAsc]);

  const counts = useMemo(() => ({
    all: items.length,
    task: items.filter((i) => i.type === "task").length,
    note: items.filter((i) => i.type === "note").length,
    plan: items.filter((i) => i.type === "plan").length,
    done: items.filter((i) => i.status === "done").length,
    in_progress: items.filter((i) => i.status === "in_progress").length,
  }), [items]);

  const openAdd = () => { setEditingItem(null); setFormOpen(true); };
  const openEdit = (item: TodoItem) => { setEditingItem(item); setFormOpen(true); setDetailItem(null); };

  const deleteItem = async (id: string) => {
    if (!confirm("Удалить?")) return;
    await todosApi.delete(id).catch(() => toast.error("Delete failed"));
    setDetailItem(null);
    reload();
  };

  const toggleStatus = async (item: TodoItem) => {
    const next: TodoStatus = item.status === "todo" ? "in_progress" : item.status === "in_progress" ? "done" : "todo";
    const updated = await todosApi.update(item.id, { status: next }).catch(() => null);
    if (updated) {
      setItems((p) => p.map((i) => i.id === item.id ? updated : i));
      if (detailItem?.id === item.id) setDetailItem(updated);
    }
  };

  return (
    <div className="todo-page">
      <div className="todo-header">
        <div>
          <h1 className="todo-title">Todo</h1>
          <p className="todo-subtitle">Задания, заметки и планы по проекту</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Создать</button>
      </div>

      <div className="todo-stats">
        <div className="todo-stat"><span className="todo-stat-val">{counts.all}</span><span className="todo-stat-label">Всего</span></div>
        <div className="todo-stat"><span className="todo-stat-val" style={{ color: "#1d4ed8" }}>{counts.in_progress}</span><span className="todo-stat-label">В работе</span></div>
        <div className="todo-stat"><span className="todo-stat-val" style={{ color: "#065f46" }}>{counts.done}</span><span className="todo-stat-label">Выполнено</span></div>
        <div className="todo-stat"><span className="todo-stat-val">{counts.task}</span><span className="todo-stat-label">Задачи</span></div>
        <div className="todo-stat"><span className="todo-stat-val">{counts.note}</span><span className="todo-stat-label">Заметки</span></div>
        <div className="todo-stat"><span className="todo-stat-val">{counts.plan}</span><span className="todo-stat-label">Планы</span></div>
      </div>

      <div className="todo-toolbar">
        <div className="todo-tabs">
          {(["all", "task", "note", "plan"] as const).map((t) => (
            <button key={t} className={"todo-tab" + (activeTab === t ? " is-active" : "")} onClick={() => setActiveTab(t)}>
              {t === "all" ? "Все" : TYPE_META[t].icon + " " + TYPE_META[t].label}
              <span className="todo-tab-cnt">{counts[t]}</span>
            </button>
          ))}
        </div>
        <div className="todo-toolbar-right">
          <input className="input todo-search" placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input" style={{ fontSize: 12 }} value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}>
            <option value="created_at">По дате создания</option>
            <option value="due_date">По дате выполнения</option>
            <option value="priority">По приоритету</option>
            <option value="status">По статусу</option>
          </select>
          <button className="btn" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => setSortAsc((v) => !v)}>
            {sortAsc ? "↑" : "↓"}
          </button>
        </div>
      </div>

      <div className="todo-filter-row">
        <span className="todo-filter-label">Статус:</span>
        {(["todo", "in_progress", "done"] as TodoStatus[]).map((s) => (
          <button key={s} className={"todo-chip" + (filterStatus.includes(s) ? " is-active" : "")}
            onClick={() => setFilterStatus((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s])}>
            {STATUS_META[s].label}
          </button>
        ))}
        <span className="todo-filter-label" style={{ marginLeft: 12 }}>Приоритет:</span>
        {(["high", "medium", "low"] as TodoPriority[]).map((pr) => (
          <button key={pr} className={"todo-chip" + (filterPriority.includes(pr) ? " is-active" : "")}
            style={{ color: PRIORITY_META[pr].color }}
            onClick={() => setFilterPriority((p) => p.includes(pr) ? p.filter((x) => x !== pr) : [...p, pr])}>
            {PRIORITY_META[pr].label}
          </button>
        ))}
        <span className="todo-filter-label" style={{ marginLeft: 12 }}>Исполнитель:</span>
        <select className="input" style={{ fontSize: 12, height: 28, padding: "2px 6px" }}
          value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
          <option value="">Все</option>
          {appUsers.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
        </select>
        <span className="todo-filter-label" style={{ marginLeft: 8 }}>Автор:</span>
        <select className="input" style={{ fontSize: 12, height: 28, padding: "2px 6px" }}
          value={filterAuthor} onChange={(e) => setFilterAuthor(e.target.value)}>
          <option value="">Все</option>
          {appUsers.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
        </select>
        {(filterStatus.length > 0 || filterPriority.length > 0 || filterAssignee || filterAuthor) && (
          <button className="btn-link" style={{ fontSize: 12 }} onClick={() => { setFilterStatus([]); setFilterPriority([]); setFilterAssignee(""); setFilterAuthor(""); }}>
            Сбросить
          </button>
        )}
      </div>

      <div className="todo-list">
        {loading ? (
          <div className="todo-empty">Загружаем…</div>
        ) : filtered.length === 0 ? (
          <div className="todo-empty">
            {items.length === 0
              ? "Пока нет записей. Нажмите «+ Создать» чтобы добавить задачу, заметку или план."
              : "Ничего не найдено по текущим фильтрам."}
          </div>
        ) : (
          filtered.map((item) => {
            const sm = STATUS_META[item.status as TodoStatus];
            const pm = PRIORITY_META[item.priority as TodoPriority];
            const tm = TYPE_META[item.type];
            return (
              <div key={item.id} className={"todo-card" + (item.status === "done" ? " todo-card--done" : "")}
                onClick={() => setDetailItem(item)}>
                <div className="todo-card-left">
                  <button className="todo-status-btn" title={`Сменить статус (${sm.label})`}
                    style={{ background: sm.bg, color: sm.color }}
                    onClick={(e) => { e.stopPropagation(); toggleStatus(item); }}>
                    {item.status === "done" ? "✓" : item.status === "in_progress" ? "▶" : "○"}
                  </button>
                </div>
                <div className="todo-card-body">
                  <div className="todo-card-row1">
                    <span className="todo-type-icon" title={tm.label}>{tm.icon}</span>
                    <span className={"todo-card-title" + (item.status === "done" ? " todo-card-title--done" : "")}>{item.title}</span>
                    <span className="todo-priority-dot" style={{ color: pm.color }}>●</span>
                    <span className="todo-priority-label" style={{ color: pm.color }}>{pm.label}</span>
                  </div>
                  {item.body && (
                    <div className="todo-card-body-text">
                      {item.body.length > 120 ? item.body.slice(0, 120) + "…" : item.body}
                    </div>
                  )}
                  <div className="todo-card-meta">
                    {item.due_date && (
                      <span className={"todo-due" + (item.status !== "done" && item.due_date < new Date().toISOString().slice(0, 10) ? " todo-due--overdue" : "")}>
                        📅 {item.due_date}
                      </span>
                    )}
                    <span className="todo-author-chip" title="Автор">✍ {getTodoAuthor(item.id)}</span>
                    {getTodoAssignee(item.id) && (
                      <span className="todo-assignee-chip" title="Исполнитель">👤 {getTodoAssignee(item.id)}</span>
                    )}
                    {item.jira_url && (
                      <a href={item.jira_url} target="_blank" rel="noopener" className="todo-jira-link"
                        onClick={(e) => e.stopPropagation()}>
                        🔗 Jira
                      </a>
                    )}
                    {item.requirement_title && (
                      <span className="todo-req-chip">📋 {item.requirement_title}</span>
                    )}
                    {item.tags.map((t) => <span key={t} className="todo-tag">{t}</span>)}
                  </div>
                </div>
                <div className="todo-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn-icon" title="Редактировать" onClick={() => openEdit(item)}>✎</button>
                  <button className="btn-icon" title="Удалить" onClick={() => deleteItem(item.id)}>🗑</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {formOpen && (
        <TodoFormModal
          initial={editingItem}
          projectId={pid}
          requirements={requirements}
          onClose={() => setFormOpen(false)}
          onSave={async (data) => {
            if (editingItem) {
              await todosApi.update(editingItem.id, data).catch(() => toast.error("Update failed"));
            } else {
              await todosApi.create({ ...data, project_id: pid }).catch(() => toast.error("Create failed"));
            }
            setFormOpen(false);
            reload();
          }}
        />
      )}

      {detailItem && (
        <TodoDetailPanel
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onEdit={() => openEdit(detailItem)}
          onDelete={() => deleteItem(detailItem.id)}
          onToggleStatus={() => toggleStatus(detailItem)}
        />
      )}
    </div>
  );
}

// ── Form modal ────────────────────────────────────────────────────────────────

type FormData = {
  type: "task" | "note" | "plan";
  title: string;
  body: string;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "medium" | "low";
  due_date: string | null;
  tags: string[];
  jira_url: string;
  requirement_id: string | null;
};

function emptyForm(): FormData {
  return { type: "task", title: "", body: "", status: "todo", priority: "medium", due_date: null, tags: [], jira_url: "", requirement_id: null };
}

function TodoFormModal({ initial, projectId: _pid, requirements, onClose, onSave }: {
  initial: TodoItem | null;
  projectId: string;
  requirements: Requirement[];
  onClose: () => void;
  onSave: (data: Omit<FormData, "jira_url"> & { jira_url: string | null }) => void;
}) {
  const [form, setForm] = useState<FormData>(
    initial
      ? {
          type: initial.type,
          title: initial.title,
          body: initial.body ?? "",
          status: initial.status as FormData["status"],
          priority: initial.priority as FormData["priority"],
          due_date: initial.due_date ?? null,
          tags: [...initial.tags],
          jira_url: initial.jira_url ?? "",
          requirement_id: initial.requirement_id ?? null,
        }
      : emptyForm()
  );
  const [tagInput, setTagInput] = useState("");

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t] });
    setTagInput("");
  };

  const handleSave = () => {
    if (!form.title.trim()) return;
    onSave({ ...form, jira_url: form.jira_url.trim() || null });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{initial ? "Редактировать" : "Создать запись"}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "70vh", overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="form-label">Тип *</label>
              <select className="input" style={{ width: "100%" }} value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as FormData["type"] })}>
                <option value="task">☑ Task</option>
                <option value="note">📝 Note</option>
                <option value="plan">📅 Plan</option>
              </select>
            </div>
            <div>
              <label className="form-label">Статус</label>
              <select className="input" style={{ width: "100%" }} value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as FormData["status"] })}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="form-label">Приоритет</label>
              <select className="input" style={{ width: "100%" }} value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as FormData["priority"] })}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Заголовок *</label>
            <input className="input" style={{ width: "100%" }} autoFocus value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Краткое описание задачи или заметки" />
          </div>

          <div>
            <label className="form-label">Содержание</label>
            <textarea className="input" style={{ width: "100%" }} rows={4} value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Описание, шаги, ссылки…" />
          </div>

          <div>
            <label className="form-label">Дата выполнения</label>
            <input type="date" className="input" style={{ width: 180 }} value={form.due_date ?? ""}
              onChange={(e) => setForm({ ...form, due_date: e.target.value || null })} />
          </div>

          {/* Jira URL */}
          <div>
            <label className="form-label">🔗 Jira Task URL</label>
            <input className="input" style={{ width: "100%" }} type="url"
              placeholder="https://jira.example.com/browse/PROJ-123"
              value={form.jira_url}
              onChange={(e) => setForm({ ...form, jira_url: e.target.value })} />
            {form.jira_url && (
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 3 }}>
                <a href={form.jira_url} target="_blank" rel="noopener" style={{ color: "var(--color-accent)" }}>
                  Открыть в Jira ↗
                </a>
              </div>
            )}
          </div>

          {/* Requirement */}
          <div>
            <label className="form-label">📋 Связать с требованием</label>
            <select className="input" style={{ width: "100%" }}
              value={form.requirement_id ?? ""}
              onChange={(e) => setForm({ ...form, requirement_id: e.target.value || null })}>
              <option value="">— Не выбрано —</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.req_type ? `[${r.req_type.toUpperCase()}] ` : ""}{r.title}
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="form-label">Теги</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
              {form.tags.map((t) => (
                <span key={t} style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)", borderRadius: 4, padding: "2px 7px", fontSize: 12, display: "flex", alignItems: "center", gap: 3 }}>
                  {t}
                  <button type="button" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit" }}
                    onClick={() => setForm({ ...form, tags: form.tags.filter((x) => x !== t) })}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Добавить тег…" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} />
              <button type="button" className="btn" onClick={addTag}>+</button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" disabled={!form.title.trim()} onClick={handleSave}>
            {initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function TodoDetailPanel({ item, onClose, onEdit, onDelete, onToggleStatus }: {
  item: TodoItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}) {
  const sm = STATUS_META[item.status as TodoStatus];
  const pm = PRIORITY_META[item.priority as TodoPriority];
  const tm = TYPE_META[item.type];

  return (
    <div className="todo-detail-overlay" onClick={onClose}>
      <div className="todo-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="todo-detail-header">
          <span className="todo-detail-type">{tm.icon} {tm.label}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" style={{ fontSize: 12 }} onClick={onEdit}>✎ Редактировать</button>
            <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={onDelete}>🗑</button>
            <button className="btn-icon" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="todo-detail-body">
          <h2 className="todo-detail-title">{item.title}</h2>
          <div className="todo-detail-meta">
            <span className="todo-chip is-active" style={{ background: sm.bg, color: sm.color, cursor: "pointer" }}
              onClick={onToggleStatus} title="Кликните для смены статуса">
              {sm.label}
            </span>
            <span style={{ color: pm.color, fontWeight: 600, fontSize: 12 }}>● {pm.label}</span>
            {item.due_date && <span className="todo-due">📅 {item.due_date}</span>}
          </div>
          {item.body && <div className="todo-detail-content">{item.body}</div>}

          {/* Jira link */}
          {item.jira_url && (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", borderRadius: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", marginBottom: 4 }}>JIRA TASK</div>
              <a href={item.jira_url} target="_blank" rel="noopener"
                style={{ color: "var(--color-accent)", fontSize: 13, wordBreak: "break-all", textDecoration: "none" }}>
                🔗 {item.jira_url}
              </a>
            </div>
          )}

          {/* Requirement */}
          {item.requirement_title && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", borderRadius: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", marginBottom: 4 }}>СВЯЗАННОЕ ТРЕБОВАНИЕ</div>
              <div style={{ fontSize: 13, color: "var(--color-text)" }}>📋 {item.requirement_title}</div>
            </div>
          )}

          {item.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 12 }}>
              {item.tags.map((t) => <span key={t} className="todo-tag">{t}</span>)}
            </div>
          )}
          <div className="todo-detail-foot">
            Создано: {new Date(item.created_at).toLocaleString("ru-RU")}
          </div>
        </div>
      </div>
    </div>
  );
}
