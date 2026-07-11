import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsMemorySystemContent from '../content/docs/settings-memory-system.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-memory-system')({
  component: () => (
    <DocsPage id="settings-memory-system">
      <SettingsMemorySystemContent />
    </DocsPage>
  )
})
