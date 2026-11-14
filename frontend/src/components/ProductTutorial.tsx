import { useEffect, useRef, useState } from "react";
import { useLocalization } from "../app/localization";

type Props = {
  onComplete: () => Promise<void>;
};

const tutorialSlides = [
  ["tutorial.dashboardTitle", "tutorial.dashboardBody"],
  ["tutorial.sofiaTitle", "tutorial.sofiaBody"],
  ["tutorial.leoTitle", "tutorial.leoBody"],
  ["tutorial.miaTitle", "tutorial.miaBody"],
  ["tutorial.creationTitle", "tutorial.creationBody"],
  ["tutorial.campaignTitle", "tutorial.campaignBody"],
  ["tutorial.reviewTitle", "tutorial.reviewBody"],
  ["tutorial.publishingTitle", "tutorial.publishingBody"],
  ["tutorial.trialTitle", "tutorial.trialBody"],
] as const;

export default function ProductTutorial({ onComplete }: Props) {
  const { t } = useLocalization();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  async function complete() {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await onComplete();
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void complete();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const buttons = Array.from(
      dialogRef.current.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const [titleKey, bodyKey] = tutorialSlides[step];
  return (
    <div className="tutorial-backdrop">
      <div
        className="tutorial-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-body"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        tabIndex={-1}
      >
        <p className="eyebrow">
          {t("tutorial.stepCount", {
            step: step + 1,
            total: tutorialSlides.length,
          })}
        </p>
        <h2 id="tutorial-title" aria-live="polite">
          {t(titleKey)}
        </h2>
        <p id="tutorial-body">{t(bodyKey)}</p>
        {error && <p role="alert">{t("tutorial.saveError")}</p>}
        <div className="tutorial-actions">
          <button
            type="button"
            className="reject-button"
            onClick={() => void complete()}
            disabled={saving}
          >
            {t("tutorial.skip")}
          </button>
          <div>
            <button
              type="button"
              className="reject-button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0 || saving}
            >
              {t("tutorial.back")}
            </button>
            {step < tutorialSlides.length - 1 ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => setStep((current) => current + 1)}
                disabled={saving}
              >
                {t("tutorial.next")}
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                onClick={() => void complete()}
                disabled={saving}
              >
                {saving ? t("common.saving") : t("tutorial.finish")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
