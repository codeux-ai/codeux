/** @jsx h */
// @vitest-environment happy-dom
import { h } from 'preact';
import { render, screen, fireEvent } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import { ProjectSettingsEditor } from '../../../../../dashboard/src/v2/components/settings/ProjectSettingsEditor';

describe('ProjectSettingsEditor', () => {
    it('renders the "Default sprint key" row and updates setting', () => {
        const mockSettings = {
            git: {
                defaultSprintKey: 'SPR'
            },
            ciIntelligence: {
                enabled: true,
                enableLivePrMonitoring: true,
                waitForCiBeforeMainMerge: true,
                resolveAllCommentsBeforeMainMerge: true,
                resolveMainMergeConflicts: false,
                waitForCiBeforeFeatureMerge: true,
                resolveAllCommentsBeforeFeatureMerge: true,
                resolveMergeConflicts: false,
                waitForJulesCiAutofix: false,
                julesCiAutofixMaxRetries: 3,
                featurePrAutoMergeMode: 'OFF',
                mainBranchAutoMergeMode: 'OFF',
            },
            sprintLoopSteps: {
                branchPreflight: true,
                planningPreflight: true,
                loadSubtasks: true,
                sessionSync: true,
                statusDerivation: true,
                startReadyTasks: true,
                mergeProtocol: true,
                actionRequiredProtocol: true,
                statusTable: true,
                watchLoop: true,
                watchLoopIntervalSeconds: 120,
                watchLoopOutputIntervalSeconds: 300,
            },
            cliWorkflow: {
                cleanupWorktreeOnSuccess: true,
                cleanupWorktreeOnFailure: false,
                retryOnReadFileNotFound: true,
                resumeFailedTaskInSameWorkspace: true,
                executionMode: 'HOST',
            },
            workers: {
                executionMode: 'isolated'
            },
            models: {
                planning: {
                    model: 'model-a'
                },
                execution: {
                    model: 'model-b'
                }
            },
            aiProvider: {
                strategy: 'MANUAL',
                provider: 'jules',
                providers: {
                    jules: { enabled: true, model: 'default' },
                    gemini: { enabled: true, model: 'default' },
                    codex: { enabled: true, model: 'gpt-5.3-codex' },
                    'claude-code': { enabled: false, model: 'default' }
                }
            },
            jules: {
                enabled: false,
                review: true,
                systemPrompt: 'System prompt',
                autoApprovePlan: false,
                reviewDiffsBeforeSubmit: false
            },
            sprintEngine: {
                enabled: true,
                mode: 'autonomous'
            },
            agents: [],
            skills: [],
            mcpTools: [],
            memory: {
                enabled: true
            },
            automationInterventions: {
                mode: 'SEMI_AUTO',
                autoApprovePlan: false,
                autoAnswerClarification: false,
                autoContinueTests: false,
                autoRunVerification: false,
                clarificationTemplate: ''
            }
        };
        const handleUpdate = vi.fn();

        render(
            <ProjectSettingsEditor
                settings={mockSettings as any}
                onChange={handleUpdate}
            />
        );

        // Verify label and description exist
        expect(screen.getByText('Default sprint key')).toBeDefined();
        expect(screen.getByText("Prefix used for new sprints, e.g., 'SPR' or 'DEV'.")).toBeDefined();

        // Find the input field
        const input = screen.getByDisplayValue('SPR') as HTMLInputElement;
        expect(input).toBeDefined();

        // Update the value
        fireEvent.input(input, { target: { value: 'DEV' } });
        fireEvent.blur(input);

        // Verify the handler was called with correct nested update structure
        expect(handleUpdate).toHaveBeenCalledWith({
            ...mockSettings,
            git: {
                ...mockSettings.git,
                defaultSprintKey: 'DEV'
            }
        });
    });
});
