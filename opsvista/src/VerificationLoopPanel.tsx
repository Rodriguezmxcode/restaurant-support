import { measurementFor, verifyAction, type VerificationStatus } from './verificationLoop';
import './verificationLoop.css';

type ActionLike = {
  automationKey?: string;
  category: string;
  location: string;
  impact: string;
  verificationStatus?: VerificationStatus;
};

type Props = {
  action: ActionLike;
  onApply: (status: VerificationStatus, note: string) => void;
};

const statusClass = (status: VerificationStatus) => status.toLowerCase().replaceAll(' ', '-');

export default function VerificationLoopPanel({ action, onApply }: Props) {
  const measurement = measurementFor(action.automationKey);
  const result = verifyAction(action, measurement);

  return <section className="verification-v2">
    <div className="verification-v2-head">
      <div>
        <span>AUTOMATIC VERIFICATION LOOP</span>
        <strong>Did the intervention actually work?</strong>
      </div>
      <span className={`verification-status ${statusClass(result.status)}`}>{result.status}</span>
    </div>

    <div className="verification-v2-grid">
      <div><label>Post-action finding</label><p>{result.summary}</p></div>
      <div><label>Measurement source</label><p>{result.source}</p></div>
      <div><label>Measured</label><p>{new Date(result.measuredAt).toLocaleString()}</p></div>
      <div><label>Confidence</label><p>{result.confidence}</p></div>
    </div>

    {(result.delta != null || result.estimatedRealizedImpact != null) && <div className="verification-impact-row">
      {result.delta != null && <div><span>Measured change</span><strong>{result.delta > 0 ? '+' : ''}{result.delta.toFixed(1)}</strong></div>}
      {result.estimatedRealizedImpact != null && <div><span>Estimated realized impact</span><strong>${result.estimatedRealizedImpact.toLocaleString('en-US')}</strong></div>}
    </div>}

    <div className="verification-v2-note">
      <strong>Decision rule</strong>
      <p>OpsVista only marks an action as verified when a post-action reading or evidence state supports it. Missing follow-up data stays open as “Not enough evidence yet.”</p>
    </div>

    <button className="verification-apply" onClick={() => onApply(result.status, result.summary)}>
      Apply verification result
    </button>
  </section>;
}
