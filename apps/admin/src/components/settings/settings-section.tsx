/**
 * Reusable Settings Section Component
 * Wraps Card/CardHeader/CardContent with consistent styling
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

interface SettingsSectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={className}>{children}</CardContent>
    </Card>
  );
}
