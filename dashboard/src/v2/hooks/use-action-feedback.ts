import { useState, useCallback } from "preact/hooks";

export type ActionFeedbackStatus = "idle" | "pending" | "success" | "error";

export interface ActionFeedbackState {
    status: ActionFeedbackStatus;
    message: string;
}

export function useActionFeedback() {
    const [feedback, setFeedbackState] = useState<ActionFeedbackState>({
        status: "idle",
        message: "",
    });

    const setFeedback = useCallback((status: ActionFeedbackStatus, message: string) => {
        setFeedbackState({ status, message });
    }, []);

    const clearFeedback = useCallback(() => {
        setFeedbackState({ status: "idle", message: "" });
    }, []);

    return {
        feedback,
        setFeedback,
        clearFeedback,
    };
}
