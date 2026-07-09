import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsDangerZoneContent from '../content/docs/settings-danger-zone.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-danger-zone')({
  component: () => (
    <DocsPage id="settings-danger-zone">
      <SettingsDangerZoneContent />
    </DocsPage>
  )
})
