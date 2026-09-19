import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import {Platform} from 'react-native';
import {actionApi} from './api';

Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:true})});

export async function registerPushDevice(){
  if(!Device.isDevice)return {registered:false,message:'Push requires a physical phone'};
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('opsvista-actions',{name:'OpsVista Actions',importance:Notifications.AndroidImportance.MAX,sound:'default',vibrationPattern:[0,250,250,250]});
  const current=await Notifications.getPermissionsAsync();
  const permission=current.status==='granted'?current:await Notifications.requestPermissionsAsync();
  if(permission.status!=='granted')return {registered:false,message:'Notification permission not granted'};
  const projectId=String(Constants.expoConfig?.extra?.eas?.projectId||'');
  if(!projectId||projectId==='REPLACE_AFTER_EAS_INIT')return {registered:false,message:'EAS project registration pending'};
  const token=(await Notifications.getExpoPushTokenAsync({projectId})).data;
  await actionApi.registerDevice(token,Platform.OS==='ios'?'ios':'android',Device.deviceName||undefined);
  return {registered:true,message:'Push notifications active'};
}

export function listenForActionPush(onOpen:(actionId?:string)=>void){
  const received=Notifications.addNotificationReceivedListener(notification=>{
    const actionId=String(notification.request.content.data?.actionId||'');
    if(actionId)void actionApi.receipt(actionId,'Delivered').catch(()=>undefined);
  });
  const opened=Notifications.addNotificationResponseReceivedListener(response=>{
    const actionId=String(response.notification.request.content.data?.actionId||'');
    if(actionId)void actionApi.receipt(actionId,'Seen').catch(()=>undefined);
    onOpen(actionId||undefined);
  });
  return()=>{received.remove();opened.remove();};
}
