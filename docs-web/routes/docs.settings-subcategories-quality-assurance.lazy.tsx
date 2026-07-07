import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesQualityAssuranceContent from '../content/docs/settings-subcategories-quality-assurance.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-quality-assurance')({
  component: () => (
    <DocsPage id="settings-subcategories-quality-assurance">
      <SettingsSubcategoriesQualityAssuranceContent />
    </DocsPage>
  )
})
