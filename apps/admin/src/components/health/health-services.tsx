import React from 'react';
import { useTranslation } from 'react-i18next';
import { Database, HardDrive, Server } from 'lucide-react';
import { ServiceStatusCard } from './service-status-card';
import type { ServiceHealth } from '@bugspotter/types';

interface Services {
  database?: ServiceHealth;
  redis?: ServiceHealth;
  storage?: ServiceHealth;
}

interface HealthServicesProps {
  services?: Services;
  getStatusColor: (status: string) => string;
}

export const HealthServices: React.FC<HealthServicesProps> = ({ services, getStatusColor }) => {
  const { t } = useTranslation();

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">{t('pages.coreServices')}</h2>
      <div className="grid gap-6 md:grid-cols-3">
        <ServiceStatusCard
          title={t('pages.database')}
          icon={Database}
          service={services?.database}
          getStatusColor={getStatusColor}
        />
        <ServiceStatusCard
          title={t('pages.redis')}
          icon={Server}
          service={services?.redis}
          getStatusColor={getStatusColor}
        />
        <ServiceStatusCard
          title={t('pages.storageService')}
          icon={HardDrive}
          service={services?.storage}
          getStatusColor={getStatusColor}
        />
      </div>
    </div>
  );
};

export default HealthServices;
