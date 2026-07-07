import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsQwenCodeIntegrationContent from '../content/docs/settings-qwen-code-integration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-qwen-code-integration')({
  component: () => (
    <DocsPage id="settings-qwen-code-integration">
      <SettingsQwenCodeIntegrationContent />
    </DocsPage>
  )
})
