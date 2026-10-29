import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import TestCaseForm from "../components/TestCaseForm";

export default function TestCaseFormPage() {
  const { projectId, caseId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  if (!projectId) return null;

  const back = () => navigate(`/project/${projectId}/repository`);
  const onSaved = () => {
    if (caseId) navigate(`/project/${projectId}/repository?openCase=${caseId}`);
    else back();
  };

  return (
    <TestCaseForm
      projectId={projectId}
      caseId={caseId}
      initialSuiteId={searchParams.get("suite") ?? undefined}
      onSaved={onSaved}
      onCancel={back}
    />
  );
}
