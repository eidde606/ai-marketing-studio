import { useState } from "react";

export function useDraftImages() {
  const [imageInstructions, setImageInstructions] = useState<
    Record<string, string>
  >({});

  const [showImageEditor, setShowImageEditor] = useState<
    Record<string, boolean>
  >({});

  const updateImageInstructions = (draftId: string, value: string) => {
    setImageInstructions((current) => ({
      ...current,
      [draftId]: value,
    }));
  };

  const addImageSuggestion = (draftId: string, suggestion: string) => {
    setImageInstructions((current) => {
      const existing = current[draftId]?.trim() || "";

      return {
        ...current,
        [draftId]: [existing, suggestion]
          .filter(Boolean)
          .join(existing ? ". " : "")
          .slice(0, 1000),
      };
    });
  };

  return {
    imageInstructions,
    setImageInstructions,
    showImageEditor,
    setShowImageEditor,
    updateImageInstructions,
    addImageSuggestion,
  };
}
