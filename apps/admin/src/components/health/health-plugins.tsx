import React from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { Card, CardContent } from '../ui/card';

interface PluginHealth {
  platform: string;
  enabled: boolean;
  type: string;
}

interface HealthPluginsProps {
  plugins: PluginHealth[];
  getPluginDisplayName: (platform: string, t: (key: string) => string) => string;
}

export const HealthPlugins: React.FC<HealthPluginsProps> = ({ plugins, getPluginDisplayName }) => {
  const { t } = useTranslation();

  if (!plugins || plugins.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">{t('pages.integrationPlugins')}</h2>
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            <Zap className="h-8 w-8 mx-auto mb-2 text-gray-400" aria-hidden="true" />
            <p>{t('pages.noPluginsRegistered')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('pages.integrationPlugins')}</h2>
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {plugins.map((plugin) => (
              <div
                key={plugin.platform}
                className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg"
              >
                <Zap
                  className={`h-4 w-4 ${plugin.enabled ? 'text-green-600' : 'text-gray-400'}`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {getPluginDisplayName(plugin.platform, t)}
                  </p>
                  <p className="text-xs text-gray-500">{plugin.type}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default HealthPlugins;
