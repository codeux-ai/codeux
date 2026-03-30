/**
 * @vitest-environment jsdom
 */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { render, cleanup } from '@testing-library/preact';
import { afterEach } from "vitest";
afterEach(cleanup);
import { describe, it, expect } from 'vitest';
import { ChatWidgetFrame } from '../../../dashboard/src/v2/components/chat/widgets/ChatWidgetFrame';

import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe('ChatWidgetFrame', () => {
  it('renders queued state', () => {
    const { getByRole, getByText } = render(
      <ChatWidgetFrame status="queued">
        Queued Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: queued');
    expect(region.className).toContain('widget-queued');
    expect(getByText('Queued Content')).toBeInTheDocument();
  });

  it('renders running state', () => {
    const { getByRole } = render(
      <ChatWidgetFrame status="running">
        Running Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: running');
    expect(region.className).toContain('widget-running');
  });

  it('renders completed state', () => {
    const { getByRole } = render(
      <ChatWidgetFrame status="completed">
        Completed Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: completed');
    expect(region.className).not.toContain('widget-queued');
    expect(region.className).not.toContain('widget-running');
    expect(region.className).toContain('hover:opacity-100');
  });

  it('renders failed state', () => {
    const { getByRole } = render(
      <ChatWidgetFrame status="failed">
        Failed Content
      </ChatWidgetFrame>
    );
    const region = getByRole('region');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-label')).toBe('Widget: failed');
    expect(region.className).toContain('bg-red-50');
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
