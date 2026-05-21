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
import { ChatAvatar } from '../../../dashboard/src/v2/components/chat/ChatAvatar';

import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe('ChatAvatar', () => {
  it('renders a Jules avatar', () => {
    const { getByRole } = render(<ChatAvatar role="jules" />);
    const img = getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('aria-label')).toBe('Jules');

    // We render raw SVG directly so we look for the <svg> element.
    const svg = img.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(img.innerHTML).toContain('jules-j-glow');
  });

  it('renders a Container avatar', () => {
    const { getByRole } = render(<ChatAvatar role="container" />);
    const img = getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('aria-label')).toBe('Container Worker');

    const svg = img.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // Verify it includes the ContainerShip svg pieces
    expect(img.innerHTML).toContain('ellipse');
  });

  it('renders a User avatar', () => {
    const { getByRole } = render(<ChatAvatar role="user" />);
    const img = getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('aria-label')).toBe('User');
    expect(img.innerHTML).toContain('lucide-user');
  });

  it('renders a System avatar', () => {
    const { getByRole } = render(<ChatAvatar role="system" />);
    const img = getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('aria-label')).toBe('System');
    expect(img.innerHTML).toContain('lucide-terminal');
  });

  it('renders an Agent avatar with custom name falling back to Bot icon', () => {
    const { getByRole } = render(<ChatAvatar role="agent" agentName="CodeBot" />);
    const img = getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('aria-label')).toBe('CodeBot');
    // Agent avatars without config now fall back to the Bot icon
    expect(img.innerHTML).toContain('lucide-bot');
  });

  it('renders a custom robot when avatarConfig is provided', () => {
    const { getByRole } = render(
      <ChatAvatar
        role="agent"
        agentName="CustomBot"
        avatarConfig={{ chassis: 'square', accent: 'amber', eyes: 'smile' } as any}
      />
    );
    const img = getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('aria-label')).toBe('CustomBot');
    const svg = img.querySelector('svg[data-testid="agent-avatar-svg"]');
    expect(svg).toBeInTheDocument();
    expect(img.innerHTML).toContain('data-cux-agent-name="CustomBot"');
  });
});
