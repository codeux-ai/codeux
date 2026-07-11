import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSystemMemoryContent from '../content/docs/settings-system-memory.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-system-memory')({
  component: () => (
    <DocsPage id="settings-system-memory">
      <SettingsSystemMemoryContent />
    </DocsPage>
  )
})
