import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import {Platform} from 'react-native';
import {actionApi} from './api';

Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:true})});

export async function registerPushDevice(){
  if(!Device.isDevice)return {registered:false,message:'Activa las notificaciones desde un teléfono físico.'};
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('opsvista-actions',{name:'OpsVista Actions',importance:Notifications.AndroidImportance.MAX,sound:'default',vibrationPattern:[0,250,250,250]});
  const current=await Notifications.getPermissionsAsync();
  const permission=current.status==='granted'?current:await Notifications.requestPermissionsAsync();
  if(permission.status!=='granted')return {registered:false,message:'Las notificaciones están desactivadas. Puedes permitirlas en Ajustes del teléfono.'};
  const projectId=String(Constants.expoConfig?.extra?.eas?.projectId||'');
  if(!projectId||projectId==='REPLACE_AFTER_EAS_INIT')return {registered:false,message:'No se pudo activar este dispositivo. Contacta a tu administrador.'};
  const token=(await Notifications.getExpoPushTokenAsync({projectId})).data;
  await actionApi.registerDevice(token,Platform.OS==='ios'?'ios':'android',Device.deviceName||undefined);
  return {registered:true,message:'Notificaciones activadas para este dispositivo.'};
}

export function listenForActionPush(onOpen:(actionId?:string)=>void){
  let active=true;
  const handled=new Set<string>();
  const received=Notifications.addNotificationReceivedListener(notification=>{
    const actionId=String(notification.request.content.data?.actionId||'');
    if(actionId)void actionApi.receipt(actionId,'Delivered').catch(()=>undefined);
  });
  const open=(response:Notifications.NotificationResponse)=>{
    const key=response.notification.request.identifier;
    if(!active||handled.has(key))return;
    handled.add(key);
    const actionId=String(response.notification.request.content.data?.actionId||'');
    if(actionId)void actionApi.receipt(actionId,'Seen').catch(()=>undefined);
    onOpen(actionId||undefined);
  };
  const opened=Notifications.addNotificationResponseReceivedListener(open);
  // The response listener alone does not recover a tap that launched a closed app.
  const initial=Notifications.getLastNotificationResponse();
  if(initial){open(initial);Notifications.clearLastNotificationResponse();}
  return()=>{active=false;received.remove();opened.remove();};
}
