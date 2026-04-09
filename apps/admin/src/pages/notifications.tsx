/**
 * Notifications Page
 * Manages notification channels, rules, and history
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/auth-context';
import { isPlatformAdmin } from '../types';
import { Bell, Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ChannelsList } from '../components/notifications/channels-list';
import { RulesList } from '../components/notifications/rules-list';
import { HistoryList } from '../components/notifications/history-list';
import { CreateChannelDialog } from '../components/notifications/create-channel-dialog';
import { CreateRuleDialog } from '../components/notifications/create-rule-dialog';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isSystemAdmin = isPlatformAdmin(user);
  const [activeTab, setActiveTab] = useState('channels');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateRule, setShowCreateRule] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Bell className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('pages.notificationsPage')}</h1>
            <p className="text-sm text-gray-600">{t('pages.manageNotifications')}</p>
          </div>
        </div>
        {activeTab === 'channels' && (
          <Button onClick={() => setShowCreateChannel(true)} disabled={!isSystemAdmin}>
            <Plus className="w-4 h-4 mr-2" />
            {t('pages.newChannel')}
          </Button>
        )}
        {activeTab === 'rules' && (
          <Button onClick={() => setShowCreateRule(true)} disabled={!isSystemAdmin}>
            <Plus className="w-4 h-4 mr-2" />
            {t('pages.newRule')}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="channels">{t('pages.channels')}</TabsTrigger>
          <TabsTrigger value="rules">{t('pages.rules')}</TabsTrigger>
          <TabsTrigger value="history">{t('pages.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('pages.notificationChannelsTitle')}</CardTitle>
              <CardDescription>{t('pages.configureChannels')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChannelsList
                onRefresh={() => setShowCreateChannel(false)}
                readOnly={!isSystemAdmin}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('pages.notificationRulesTitle')}</CardTitle>
              <CardDescription>{t('pages.defineRules')}</CardDescription>
            </CardHeader>
            <CardContent>
              <RulesList onRefresh={() => setShowCreateRule(false)} readOnly={!isSystemAdmin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('pages.notificationHistoryTitle')}</CardTitle>
              <CardDescription>{t('pages.viewDeliveryHistory')}</CardDescription>
            </CardHeader>
            <CardContent>
              <HistoryList />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateChannelDialog
        open={showCreateChannel}
        onOpenChange={setShowCreateChannel}
        onSuccess={() => setShowCreateChannel(false)}
      />
      <CreateRuleDialog
        open={showCreateRule}
        onOpenChange={setShowCreateRule}
        onSuccess={() => setShowCreateRule(false)}
      />
    </div>
  );
}
