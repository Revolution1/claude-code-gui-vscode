import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelSelectorModal } from "../../webview/components/Modals/ModelSelectorModal";

describe("ModelSelectorModal", () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        selectedModel: "claude-sonnet-4-6",
        onSelectModel: vi.fn(),
        onConfigure: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("rendering", () => {
        it("should render modal when open", () => {
            render(<ModelSelectorModal {...defaultProps} />);

            expect(screen.getByText("Enforce Model")).toBeInTheDocument();
        });

        it("should not render when closed", () => {
            render(<ModelSelectorModal {...defaultProps} isOpen={false} />);

            expect(screen.queryByText("Enforce Model")).not.toBeInTheDocument();
        });

        it("should show description", () => {
            render(<ModelSelectorModal {...defaultProps} />);

            expect(
                screen.getByText(/This overrides your default model setting/),
            ).toBeInTheDocument();
        });
    });

    describe("model options", () => {
        it("should show Sonnet option", () => {
            render(<ModelSelectorModal {...defaultProps} />);

            expect(screen.getByText(/Sonnet 4.6 - Balanced performance/)).toBeInTheDocument();
        });

        it("should show Opus option", () => {
            render(<ModelSelectorModal {...defaultProps} />);

            expect(screen.getByText(/Opus 4.6 - Most capable model/)).toBeInTheDocument();
        });

        it("should show Haiku option", () => {
            render(<ModelSelectorModal {...defaultProps} />);

            expect(screen.getByText(/Haiku 4.5 - Fast and efficient/)).toBeInTheDocument();
        });

        it("should render radio buttons for each model", () => {
            render(<ModelSelectorModal {...defaultProps} />);

            const radios = screen.getAllByRole("radio");
            expect(radios.length).toBe(3);
        });
    });

    describe("selection", () => {
        it("should show sonnet as selected", () => {
            render(
                <ModelSelectorModal
                    {...defaultProps}
                    selectedModel="claude-sonnet-4-6"
                />,
            );

            const radios = screen.getAllByRole("radio");
            expect(radios[0]).toBeChecked();
        });

        it("should show opus as selected", () => {
            render(
                <ModelSelectorModal
                    {...defaultProps}
                    selectedModel="claude-opus-4-6"
                />,
            );

            const radios = screen.getAllByRole("radio");
            expect(radios[1]).toBeChecked();
        });

        it("should show haiku as selected", () => {
            render(
                <ModelSelectorModal
                    {...defaultProps}
                    selectedModel="claude-haiku-4-5-20251001"
                />,
            );

            const radios = screen.getAllByRole("radio");
            expect(radios[2]).toBeChecked();
        });

        it("should call onSelectModel with full model ID when clicked", () => {
            const onSelectModel = vi.fn();
            render(<ModelSelectorModal {...defaultProps} onSelectModel={onSelectModel} />);

            fireEvent.click(screen.getByText(/Opus 4.6 - Most capable model/));

            expect(onSelectModel).toHaveBeenCalledWith("claude-opus-4-6");
        });

        it("should call onSelectModel with haiku ID when haiku option clicked", () => {
            const onSelectModel = vi.fn();
            render(<ModelSelectorModal {...defaultProps} onSelectModel={onSelectModel} />);

            fireEvent.click(screen.getByText(/Haiku 4.5 - Fast and efficient/));

            expect(onSelectModel).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
        });

        it("should close modal after selection", () => {
            const onClose = vi.fn();
            render(<ModelSelectorModal {...defaultProps} onClose={onClose} />);

            fireEvent.click(screen.getByText(/Opus 4.6 - Most capable model/));

            expect(onClose).toHaveBeenCalled();
        });
    });

    describe("selected styling", () => {
        it("should apply active styling to selected model", () => {
            const { container } = render(
                <ModelSelectorModal
                    {...defaultProps}
                    selectedModel="claude-opus-4-6"
                />,
            );

            const labels = container.querySelectorAll("label");
            expect(labels[1].className).toContain(
                "bg-[var(--vscode-list-activeSelectionBackground)]",
            );
        });
    });

    describe("custom available models", () => {
        it("should use custom available models when provided", () => {
            render(
                <ModelSelectorModal
                    {...defaultProps}
                    availableModels={[
                        {
                            id: "claude-sonnet-4-6",
                            displayName: "Claude Sonnet 4.6",
                            shortName: "Sonnet 4.6",
                            description: "Latest model",
                            contextWindow: 200000,
                            pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
                        },
                    ]}
                />,
            );

            expect(screen.getByText(/Sonnet 4.6 - Latest model/)).toBeInTheDocument();
            expect(screen.queryByText(/Opus 4.6/)).not.toBeInTheDocument();
        });
    });
});
