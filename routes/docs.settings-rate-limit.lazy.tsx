import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsRateLimitContent from '../content/docs/settings-rate-limit.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-rate-limit')({
  component: () => (
    <DocsPage id="settings-rate-limit">
      <SettingsRateLimitContent />
    </DocsPage>
  )
})
