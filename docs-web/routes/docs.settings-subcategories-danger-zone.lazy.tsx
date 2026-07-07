import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesDangerZoneContent from '../content/docs/settings-subcategories-danger-zone.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-danger-zone')({
  component: () => (
    <DocsPage id="settings-subcategories-danger-zone">
      <SettingsSubcategoriesDangerZoneContent />
    </DocsPage>
  )
})
