/**
 * Aetherium Automata - Notification Toast Component
 */

import React from 'react';
import { useUIStore } from '../../stores';
import { IconInfo, IconSuccess, IconWarning, IconError, IconX } from './Icons';

const getIcon = (type: string) => {
  switch (type) {
    case 'success':
      return <IconSuccess size={18} />;
    case 'warning':
      return <IconWarning size={18} />;
    case 'error':
      return <IconError size={18} />;
    default:
      return <IconInfo size={18} />;
  }
};

export const NotificationToasts: React.FC = () => {
  const notifications = useUIStore((state) => state.notifications);
  const removeNotification = useUIStore((state) => state.removeNotification);
  
  if (notifications.length === 0) {
    return null;
  }
  
  return (
    <div className="toast-container">
      {notifications.map((notification) => (
        <div key={notification.id} className={`toast ${notification.type}`}>
          <span className="toast-icon">{getIcon(notification.type)}</span>
          <div className="toast-content">
            <div className="toast-title">{notification.title}</div>
            <div className="toast-message">{notification.message}</div>
          </div>
          <span
            className="toast-close"
            onClick={() => removeNotification(notification.id)}
          >
            <IconX size={14} />
          </span>
        </div>
      ))}
    </div>
  );
};
