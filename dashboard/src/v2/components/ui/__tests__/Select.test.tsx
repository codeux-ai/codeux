/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { expect, test, afterEach, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { Select } from '../Select.js';
import { AvantgardeSelect } from '../AvantgardeSelect.js';
import { ModelCombobox, resetModelCatalogCache } from '../ModelCombobox.js';
import { ProviderCombobox, resetProviderCatalogCache } from '../ProviderCombobox.js';

expect.extend(matchers);

afterEach(() => {
    vi.restoreAllMocks();
    resetModelCatalogCache();
    resetProviderCatalogCache();
    cleanup();
});

test('passes down aria attributes correctly', () => {
    render(
        <Select aria-label="Pick an option" aria-describedby="help-text" aria-invalid="true" aria-errormessage="error-msg">
            <option value="1">Option 1</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Pick an option' });
    expect(select).toBeInTheDocument();
    expect(select).toHaveAttribute('aria-describedby', 'help-text');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-errormessage', 'error-msg');
});

test('handles disabled controls', () => {
    render(<Select aria-label="Disabled Select" disabled><option value="1">Option 1</option></Select>);

    const select = screen.getByRole('combobox', { name: 'Disabled Select' });
    expect(select).toBeDisabled();
});

test('applies valid attributes correctly', () => {
    render(
        <Select aria-label="Valid Select" valid={true}>
            <option value="1">Option 1</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Valid Select' });
    expect(select).toHaveAttribute('data-valid', 'true');
});

test('wires helper and error text without dropping caller aria metadata', () => {
    render(
        <Select
            id="quality"
            aria-label="Quality"
            aria-describedby="external-help"
            errorText="Choose a quality level"
            helperText="Used for worker defaults"
        >
            <option value="">Default</option>
        </Select>
    );

    const select = screen.getByRole('combobox', { name: 'Quality' });
    const error = screen.getByRole('alert');

    expect(error).toHaveAttribute('id', 'quality-error');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'quality-error external-help');
    expect(select).toHaveAttribute('aria-errormessage', 'quality-error');
});

test('AvantgardeSelect exposes selected and unavailable option state accessibly', async () => {
    const onChange = vi.fn();
    render(
        <AvantgardeSelect
            value="stable"
            onChange={onChange}
            aria-label="Runtime"
            options={[
                { value: 'stable', label: 'Stable', description: 'Recommended lane', meta: 'Default' },
                { value: 'preview', label: 'Preview', disabled: true, unavailableReason: 'Unavailable' },
            ]}
        />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Runtime' }));

    const selected = await screen.findByRole('option', { name: /Stable/ });
    const unavailable = screen.getByRole('option', { name: /Preview/ });

    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(unavailable);
    expect(onChange).not.toHaveBeenCalled();
});

test('ProviderCombobox renders provider identity, endpoint metadata, and selection callback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
            { id: 'openai', name: 'OpenAI', apiBaseUrl: 'https://api.openai.com/v1' },
        ],
    }));
    const onChange = vi.fn();

    render(<ProviderCombobox value="" onChange={onChange} aria-label="API provider" />);

    fireEvent.click(screen.getByRole('button', { name: 'API provider' }));

    await screen.findByText('OpenAI');
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('Published API endpoint')).toBeInTheDocument();
    expect(screen.getByText('https://api.openai.com/v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /OpenAI/ }));
    expect(onChange).toHaveBeenCalledWith('openai', 'https://api.openai.com/v1');
});

test('ModelCombobox renders model id, provider, context, and pricing metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
            {
                id: 'anthropic/claude-sonnet-4-5',
                providerId: 'anthropic',
                providerName: 'Anthropic',
                modelId: 'claude-sonnet-4-5',
                modelName: 'Claude Sonnet 4.5',
                cost: { inputTokens: 3, outputTokens: 15, cachedInputTokens: 0.3 },
                contextLimit: 200000,
                outputLimit: 64000,
                reasoning: true,
                toolCall: true,
                openWeights: false,
                knowledge: undefined,
                releaseDate: undefined,
            },
        ],
    }));

    render(<ModelCombobox value="" onChange={() => {}} aria-label="Model" />);

    fireEvent.click(screen.getByRole('button', { name: 'Model' }));

    await waitFor(() => expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument());
    expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('200K ctx')).toBeInTheDocument();
    expect(screen.getByText('$3 in / $15 out')).toBeInTheDocument();
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
});
