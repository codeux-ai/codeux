/**
 * @vitest-environment happy-dom
 */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { render, cleanup } from '@testing-library/preact';
import { afterEach } from "vitest";
afterEach(cleanup);
import { describe, it, expect } from 'vitest';
import { ChatWidgetFrame } from '../../../dashboard/src/v2/components/chat/widgets/ChatWidgetFrame';
import { ExternalReferenceWidget } from '../../../dashboard/src/v2/components/chat/widgets/ExternalReferenceWidget';
import type { ExternalReferenceWidgetState } from '../../../dashboard/src/v2/lib/chat-widget-view-models';

import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe('ChatWidgetFrame', () => {
  it('renders queued state with dashed border', () => {
    const { getByRole, getByText } = render(
      <ChatWidgetFrame status="queued">
        Queued Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: queued');
    expect(region.className).toContain('border-dashed');
    expect(getByText('Queued Content')).toBeInTheDocument();
  });

  it('renders running state with signal accent', () => {
    const { getByRole } = render(
      <ChatWidgetFrame status="running">
        Running Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: running');
    expect(region.className).toContain('before:bg-signal-500');
    expect(region.className).toContain('backdrop-blur-xl');
  });

  it('renders completed state with reduced opacity', () => {
    const { getByRole } = render(
      <ChatWidgetFrame status="completed">
        Completed Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: completed');
    expect(region.className).toContain('opacity-80');
    expect(region.className).toContain('hover:opacity-100');
  });

  it('renders failed state with red accent', () => {
    const { getByRole } = render(
      <ChatWidgetFrame status="failed">
        Failed Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: failed');
    expect(region.className).toContain('before:bg-status-red/60');
  });

  it('renders header and footer when provided', () => {
    const { getByText } = render(
      <ChatWidgetFrame status="completed" header="Header Text" footer="Footer Text">
        Content
      </ChatWidgetFrame>
    );
    expect(getByText('Header Text')).toBeInTheDocument();
    expect(getByText('Footer Text')).toBeInTheDocument();
    expect(getByText('Content')).toBeInTheDocument();
  });
});

describe('ExternalReferenceWidget', () => {
  const reference: ExternalReferenceWidgetState = {
    provider: "github",
    providerLabel: "GitHub",
    kind: "pull_request",
    kindLabel: "Pull request",
    title: "Add compact external reference widgets",
    key: null,
    number: 42,
    identifierLabel: "#42",
    state: "open",
    stateLabel: "Open",
    url: "https://github.com/codeux-ai/codeux/pull/42",
    repositoryPath: "codeux-ai/codeux",
    projectPath: null,
    labels: ["dashboard", "chat"],
    assignee: "Reviewer",
    author: "Author",
    preview: "Renders linked work without showing raw JSON in the message body.",
    ariaLabel: "GitHub. Pull request. Add compact external reference widgets. #42. Open",
  };

  it('renders provider-specific reference details and a safe external link', () => {
    const { getByRole, getByText } = render(
      <ExternalReferenceWidget status="queued" reference={reference} />
    );

    expect(getByRole('region')).toHaveAttribute('aria-label', 'Widget: queued');
    expect(getByText('GitHub')).toBeInTheDocument();
    expect(getByText('Pull request')).toBeInTheDocument();
    expect(getByText('#42')).toBeInTheDocument();
    expect(getByText('codeux-ai/codeux')).toBeInTheDocument();
    expect(getByText('dashboard')).toBeInTheDocument();
    expect(getByText('Renders linked work without showing raw JSON in the message body.')).toBeInTheDocument();

    const link = getByRole('link', { name: /open github pull request/i });
    expect(link).toHaveAttribute('href', 'https://github.com/codeux-ai/codeux/pull/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not render unsafe URL schemes as links', () => {
    const unsafeReference = {
      ...reference,
      provider: "jira",
      providerLabel: "Jira",
      kind: "issue",
      kindLabel: "Issue",
      key: "UX-9",
      number: null,
      identifierLabel: "UX-9",
      url: "javascript:alert(1)",
      repositoryPath: null,
      projectPath: "UX",
      ariaLabel: "Jira. Issue. Add compact external reference widgets. UX-9. Open",
    } satisfies ExternalReferenceWidgetState;

    const { queryByRole, getByText } = render(
      <ExternalReferenceWidget status="running" reference={unsafeReference} />
    );

    expect(getByText('Jira')).toBeInTheDocument();
    expect(getByText('UX-9')).toBeInTheDocument();
    expect(queryByRole('link')).not.toBeInTheDocument();
  });
});
