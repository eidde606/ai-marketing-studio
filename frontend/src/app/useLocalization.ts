import { useContext } from "react";
import "./localization";
import { LocalizationContext } from "./localizationContext";

export function useLocalization() {
  return useContext(LocalizationContext);
}
