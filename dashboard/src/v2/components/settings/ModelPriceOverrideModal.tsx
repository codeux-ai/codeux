import { h, FunctionComponent } from "preact";
import { useState, useEffect } from "preact/hooks";
import { Banknote } from "lucide-preact";
import { Modal } from "../ui/Modal.js";
import { NumberInput, Row } from "./SettingsFormFields.js";
import type { TokenPricing } from "../../../../../src/contracts/app-types.js";

interface ModelPriceOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelLabel: string;
  basePrice: TokenPricing | undefined;
  override: TokenPricing | undefined;
  onSave: (pricing: TokenPricing | undefined) => void;
}

export const ModelPriceOverrideModal: FunctionComponent<ModelPriceOverrideModalProps> = ({
  isOpen,
  onClose,
  modelLabel,
  basePrice,
  override,
  onSave,
}) => {
  const [inputTokens, setInputTokens] = useState<number>(0);
  const [outputTokens, setOutputTokens] = useState<number>(0);
  const [cachedInputTokens, setCachedInputTokens] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      const seed = override ?? basePrice;
      setInputTokens(seed?.inputTokens ?? 0);
      setOutputTokens(seed?.outputTokens ?? 0);
      setCachedInputTokens(seed?.cachedInputTokens ?? 0);
    }
  }, [isOpen, override, basePrice]);

  const handleSave = () => {
    const normalize = (val: number) => Math.max(0, isNaN(val) ? 0 : val);
    const normalizedPricing: TokenPricing = {
      inputTokens: normalize(inputTokens),
      outputTokens: normalize(outputTokens),
      cachedInputTokens: normalize(cachedInputTokens),
    };

    if (normalizedPricing.inputTokens > 0 || normalizedPricing.outputTokens > 0 || normalizedPricing.cachedInputTokens > 0) {
      onSave(normalizedPricing);
    } else {
      onSave(undefined);
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-full max-w-lg"
      ariaLabelledBy="model-price-override-title"
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <h2 id="model-price-override-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Price override
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {modelLabel} — cost per million tokens. Leave all fields at 0 to fall back to the catalogue base price.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Row label="Input tokens" description={basePrice ? `Catalogue base price: $${basePrice.inputTokens}/M.` : "No published base price."}>
            <NumberInput value={inputTokens} onChange={setInputTokens} min={0} step={0.01} />
          </Row>
          <Row label="Output tokens" description={basePrice ? `Catalogue base price: $${basePrice.outputTokens}/M.` : "No published base price."}>
            <NumberInput value={outputTokens} onChange={setOutputTokens} min={0} step={0.01} />
          </Row>
          <Row label="Cached input tokens" description={basePrice ? `Catalogue base price: $${basePrice.cachedInputTokens}/M.` : "No published base price."}>
            <NumberInput value={cachedInputTokens} onChange={setCachedInputTokens} min={0} step={0.01} />
          </Row>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-black/[0.08] bg-transparent px-4 py-2 text-sm font-bold text-slate-700 hover:bg-black/[0.02] dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.02]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-[var(--elevation-raised)] hover:bg-amber-600 transition-colors"
          >
            Save override
          </button>
        </div>
      </div>
    </Modal>
  );
};
