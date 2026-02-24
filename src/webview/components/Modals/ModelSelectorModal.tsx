import React, { useCallback } from "react";
import { Modal } from "./Modal";
import { MODEL_REGISTRY } from "../../../shared/constants";
import type { ModelInfo } from "../../../shared/constants";

export interface ModelSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Full model ID, e.g. "claude-sonnet-4-5-20250929" */
    selectedModel: string;
    /** Callback with full model ID */
    onSelectModel: (modelId: string) => void;
    onConfigure: () => void;
    /** Optional dynamic model list; falls back to MODEL_REGISTRY */
    availableModels?: ModelInfo[];
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
    isOpen,
    onClose,
    selectedModel,
    onSelectModel,
    onConfigure,
    availableModels,
}) => {
    const models = availableModels ?? MODEL_REGISTRY;

    const handleSelect = useCallback(
        (modelId: string) => {
            onSelectModel(modelId);
            onClose();
        },
        [onSelectModel, onClose],
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Enforce Model" width="sm">
            <div className="space-y-4">
                <p className="text-xs text-[var(--vscode-descriptionForeground)]">
                    This overrides your default model setting for this conversation only.
                </p>

                <div className="space-y-2">
                    {models.map((model) => (
                        <label
                            key={model.id}
                            className={`
                flex items-start gap-3 p-3 rounded-md cursor-pointer transition-colors
                border border-[var(--vscode-editorWidget-border)]
                ${
                    selectedModel === model.id
                        ? "bg-[var(--vscode-list-activeSelectionBackground)] border-[var(--vscode-focusBorder)]"
                        : "hover:bg-[var(--vscode-list-hoverBackground)]"
                }
              `}
                            onClick={() => handleSelect(model.id)}
                        >
                            <input
                                type="radio"
                                name="model"
                                value={model.id}
                                checked={selectedModel === model.id}
                                onChange={() => handleSelect(model.id)}
                                className="mt-1 w-4 h-4"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium">
                                        {model.shortName} - {model.description}
                                    </span>
                                </div>
                                <p className="text-xs text-[var(--vscode-descriptionForeground)] mt-0.5">
                                    {model.displayName}
                                </p>
                            </div>
                        </label>
                    ))}
                </div>

                <button
                    onClick={onConfigure}
                    className="w-full px-3 py-2 text-xs rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-textLink-foreground)] border border-[var(--vscode-editorWidget-border)]"
                >
                    Configure Default Model
                </button>
            </div>
        </Modal>
    );
};

export default ModelSelectorModal;
