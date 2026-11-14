import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocalization } from "../app/localization";
import type { Section } from "./Sidebar";

type Props = {
  activeSection: Section;
  initialStep: number;
  onComplete: (step: number) => Promise<void>;
  onNavigate: (section: Section) => void;
  onStepChange: (step: number) => Promise<void>;
};

const tutorialSlides = [
  {
    title: "tutorial.dashboardTitle",
    body: "tutorial.dashboardBody",
    section: "Resumen",
    target: "dashboard-overview",
  },
  {
    title: "tutorial.sofiaTitle",
    body: "tutorial.sofiaBody",
    section: "Equipo IA",
    target: "sofia-overview",
  },
  {
    title: "tutorial.leoTitle",
    body: "tutorial.leoBody",
    section: "Equipo IA",
    target: "leo-generation",
  },
  {
    title: "tutorial.miaTitle",
    body: "tutorial.miaBody",
    section: "Analíticas",
    target: "mia-analytics",
  },
  {
    title: "tutorial.creationTitle",
    body: "tutorial.creationBody",
    section: "Resumen",
    target: "quick-create",
  },
  {
    title: "tutorial.guidedTitle",
    body: "tutorial.guidedBody",
    section: "Equipo IA",
    target: "sofia-guided",
  },
  {
    title: "tutorial.campaignTitle",
    body: "tutorial.campaignBody",
    section: "Campañas",
    target: "campaign-create",
  },
  {
    title: "tutorial.reviewTitle",
    body: "tutorial.reviewBody",
    section: "Aprobaciones",
    target: "approval-queue",
  },
  {
    title: "tutorial.publishingTitle",
    body: "tutorial.publishingBody",
    section: "Aprobaciones",
    target: "publish-options",
  },
  {
    title: "tutorial.trialTitle",
    body: "tutorial.trialBody",
    section: "Configuración",
    target: "trial-settings",
  },
] as const satisfies ReadonlyArray<{
  title: string;
  body: string;
  section: Section;
  target: string;
}>;

export default function ProductTutorial({
  activeSection,
  initialStep,
  onComplete,
  onNavigate,
  onStepChange,
}: Props) {
  const { t } = useLocalization();
  const [step, setStep] = useState(() =>
    Math.min(Math.max(initialStep, 0), tutorialSlides.length - 1),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const slide = tutorialSlides[step];

  useEffect(() => {
    if (activeSection !== slide.section) {
      onNavigate(slide.section);
      return;
    }

    const target = document.querySelector<HTMLElement>(
      `[data-guide-target="${slide.target}"]`,
    );
    if (!target) return;
    target.classList.add("product-guide-highlight");
    target.scrollIntoView?.({ behavior: "smooth", block: "center" });
    return () => target.classList.remove("product-guide-highlight");
  }, [activeSection, onNavigate, slide.section, slide.target]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  async function complete() {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await onComplete(step);
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  async function moveTo(nextStep: number) {
    if (saving || nextStep < 0 || nextStep >= tutorialSlides.length) return;
    setSaving(true);
    setError(false);
    try {
      await onStepChange(nextStep);
      setStep(nextStep);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void complete();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      void moveTo(step - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      void moveTo(step + 1);
    }
  }

  return (
    <aside
      className="product-guide panel"
      aria-label={t("tutorial.title")}
      onKeyDown={handleKeyDown}
    >
      <p className="eyebrow">
        {t("tutorial.stepCount", {
          step: step + 1,
          total: tutorialSlides.length,
        })}
      </p>
      <h2 id="tutorial-title" ref={headingRef} tabIndex={-1} aria-live="polite">
        {t(slide.title)}
      </h2>
      <p>{t(slide.body)}</p>
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
            onClick={() => void moveTo(step - 1)}
            disabled={step === 0 || saving}
          >
            {t("tutorial.back")}
          </button>
          {step < tutorialSlides.length - 1 ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void moveTo(step + 1)}
              disabled={saving}
            >
              {saving ? t("common.saving") : t("tutorial.next")}
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
    </aside>
  );
}
