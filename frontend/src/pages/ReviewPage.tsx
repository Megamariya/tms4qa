import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { casesApi, plansApi, type TestCase, type TestPlan } from "../api/client";
import "./ReviewPage.css";

export default function ReviewPage() {
  const { projectId } = useParams();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([casesApi.list(projectId), plansApi.list(projectId)])
      .then(([c, p]) => {
        setCases(c.filter((tc) => tc.status === "review"));
        setPlans(p.filter((pl) => pl.status === "review"));
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div className="page" style={{ padding: 40 }}>Загружаем…</div>;

  const isEmpty = cases.length === 0 && plans.length === 0;

  return (
    <div className="rv-page">
      <div className="rv-header">
        <h1 className="rv-title">Review</h1>
        <p className="rv-subtitle">Test cases and plans pending peer review before becoming active.</p>
      </div>

      {isEmpty && (
        <div className="rv-empty">
          <div className="rv-empty-icon">◎</div>
          <h2>No items pending review</h2>
          <p>Set a test case status to <strong>Review</strong> or a test plan status to <strong>Review</strong> to see them here.</p>
        </div>
      )}

      {cases.length > 0 && (
        <section className="rv-section">
          <div className="rv-section-head">
            <h2 className="rv-section-title">Test Cases</h2>
            <span className="rv-count">{cases.length}</span>
          </div>
          <table className="rv-table">
            <thead><tr>
              <th className="rv-th">ID</th>
              <th className="rv-th">Title</th>
              <th className="rv-th">Severity</th>
              <th className="rv-th">Priority</th>
              <th className="rv-th">Type</th>
              <th className="rv-th"></th>
            </tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="rv-tr">
                  <td className="rv-td"><span className="rv-id-badge">CASE-{c.id.slice(0,6).toUpperCase()}</span></td>
                  <td className="rv-td rv-td-title">{c.name}</td>
                  <td className="rv-td"><span className={`rv-badge rv-sev-${c.severity}`}>{c.severity}</span></td>
                  <td className="rv-td"><span className={`rv-badge rv-pri-${c.priority}`}>{c.priority}</span></td>
                  <td className="rv-td rv-muted">{c.type}</td>
                  <td className="rv-td">
                    <Link to={`/project/${projectId}/repository/case/${c.id}/edit`} className="rv-action-btn">✎ Review</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {plans.length > 0 && (
        <section className="rv-section">
          <div className="rv-section-head">
            <h2 className="rv-section-title">Test Plans</h2>
            <span className="rv-count">{plans.length}</span>
          </div>
          <table className="rv-table">
            <thead><tr>
              <th className="rv-th">ID</th>
              <th className="rv-th">Title</th>
              <th className="rv-th">Cases</th>
              <th className="rv-th">Created</th>
              <th className="rv-th"></th>
            </tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="rv-tr">
                  <td className="rv-td"><span className="rv-id-badge rv-id-plan">{p.display_id}</span></td>
                  <td className="rv-td rv-td-title">{p.name}</td>
                  <td className="rv-td rv-muted">{p.case_count}</td>
                  <td className="rv-td rv-muted">{new Date(p.created_at).toLocaleDateString("ru-RU")}</td>
                  <td className="rv-td">
                    <Link to={`/project/${projectId}/plan/${p.id}`} className="rv-action-btn">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
