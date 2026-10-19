import type { QuestionKind } from "@/lib/types";

export const KIND_LABEL: Record<QuestionKind, string> = {
  rating5: "Rating 1–5",
  nps: "Recommend 0–10",
  yesno: "Yes / No",
  choice: "Pick one",
  text: "Free text",
};
