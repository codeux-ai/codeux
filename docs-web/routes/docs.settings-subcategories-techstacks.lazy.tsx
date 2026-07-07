import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesTechstacksContent from '../content/docs/settings-subcategories-techstacks.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-techstacks')({
  component: () => (
    <DocsPage id="settings-subcategories-techstacks">
      <SettingsSubcategoriesTechstacksContent />
    </DocsPage>
  )
})
