import { useEffect, useMemo } from "react";

import { experimentConfigByKey } from "@/config/experiments";
import { evaluateExperiment, getExperimentSubjectId, persistExperimentAssignment, trackExperimentEvent } from "@/experiments";
import type { ExperimentAssignment, ExperimentSubject } from "@/experiments";

export function useExperiment(experimentKey: string, subject: ExperimentSubject = {}): ExperimentAssignment {
  const subjectId = getExperimentSubjectId(subject);
  const rolesKey = (subject.roles ?? []).join("|");

  const assignment = useMemo(
    () => evaluateExperiment(experimentConfigByKey[experimentKey], subject),
    [experimentKey, subject]
  );

  useEffect(() => {
    persistExperimentAssignment(assignment);
    if (assignment.reason === "assigned") {
      trackExperimentEvent({
        type: "experiment_exposure",
        experimentKey: assignment.experimentKey,
        variant: assignment.variant,
        subjectId,
      });
    }
  }, [assignment, subjectId]);

  return assignment;
}
