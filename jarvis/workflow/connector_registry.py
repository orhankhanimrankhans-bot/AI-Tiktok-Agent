"""Searchable descriptors and lazy factories for workflow connectors."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable

@dataclass(frozen=True)
class ConnectorDescriptor:
    id:str; provider:str; name:str; description:str; category:str; kind:str="action"; implemented:bool=True; keywords:tuple[str,...]=(); defaults:dict=field(default_factory=dict)

class ConnectorRegistry:
    def __init__(self): self._items={}; self._factories={}
    def register(self, descriptor, factory=None): self._items[descriptor.id]=descriptor; self._factories[descriptor.id]=factory
    def descriptor(self,node_type): return self._items.get(node_type)
    def create(self,node_type):
        factory=self._factories.get(node_type)
        if factory is None: raise RuntimeError(f"Connector unavailable for {node_type}.")
        return factory()
    def search(self,text="",kind=None):
        query=text.casefold().strip(); terms=query.split(); values=[]
        for item in self._items.values():
            haystack=" ".join((item.id,item.provider,item.name,item.description,item.category,*item.keywords)).casefold()
            if all(term in haystack for term in terms) and (kind is None or item.kind==kind): values.append(item)
        def rank(item):
            provider=item.provider.casefold(); name=item.name.casefold(); keywords=" ".join(item.keywords).casefold(); description=item.description.casefold()
            if not query: relevance=10
            elif provider.startswith(query) or name.startswith(query): relevance=0
            elif query in provider: relevance=1
            elif query in name: relevance=2
            elif query in keywords: relevance=3
            elif query in description: relevance=4
            else: relevance=5
            return relevance, not item.implemented, item.category, item.name
        return sorted(values,key=rank)

def build_default_registry(jarvis_process=None, allowed_root=None):
    from pathlib import Path
    from .connectors.file_connector import FileConnector
    from .connectors.http_connector import HttpConnector
    from .connectors.jarvis_core import JarvisCoreConnector
    registry=ConnectorRegistry()
    descriptors=(
      ConnectorDescriptor("manual_trigger","jarvis","Manual Trigger","Start immediately from Run","triggers","trigger",True,("start",)),
      ConnectorDescriptor("schedule_trigger","schedule","Schedule Trigger","Start automatically or test the configured schedule","triggers","trigger",True,("timer","daily","hourly","cron"),{"operation":"test","timezone":"local","enabled":True,"rules":[{"interval_type":"seconds","seconds":30},{"interval_type":"days","days":1,"hour":0,"minute":0}],"always_output_data":True,"execute_once":False,"on_error":"stop","display_note_in_flow":False,"_retry":False,"_notes":""}),
      ConnectorDescriptor("webhook_trigger","web","Webhook Trigger","Start from an incoming webhook","triggers","trigger",False),
      ConnectorDescriptor("file_trigger","file","File Trigger","Start when a file changes","triggers","trigger",False),
      ConnectorDescriptor("ask_jarvis","jarvis","Ask Jarvis","Use the existing Jarvis backend","jarvis","action",True,("ai","prompt"),{"operation":"ask","prompt":"{{$json.prompt}}"}),
      ConnectorDescriptor("facebook_graph_api","facebook","Facebook Graph API","Interact with Facebook using the Meta Graph API","social","action",True,("meta","page"),{"connector":"facebook","operation":"custom_graph_request","credential_id":"facebook_default","method":"GET","node":"me","edge":"","params":{"fields":"id,name"}}),
      ConnectorDescriptor("facebook_page_post","facebook","Facebook Page Post","Publish a real Page post","social","action",True,("meta","caption"),{"connector":"facebook","operation":"create_page_post","message":"{{$json.caption}}"}),
      ConnectorDescriptor("facebook_page_video","facebook","Facebook Page Video","Upload a real Page video","social","action",True,("meta","video"),{"connector":"facebook","operation":"upload_page_video","video_path":"{{$json.video_path}}","description":"{{$json.caption}}"}),
      ConnectorDescriptor("facebook_trigger","facebook","Facebook Trigger","Receive Facebook webhook events","social","trigger",False,("webhook",)),
      ConnectorDescriptor("facebook_lead_ads_trigger","facebook","Facebook Lead Ads Trigger","Start from supported Lead Ads webhook events","social","trigger",False,("lead","ads","webhook")),
      ConnectorDescriptor("facebook_webhook","facebook","Facebook Webhook","Receive Meta webhook events","social","trigger",False),
      ConnectorDescriptor("google_drive_search","google_drive","Search Files and Folders","Search Google Drive for files or folders","data","action",True,("drive","file","folder"),{"provider":"google_drive","operation":"search","credential_id":"google_drive_default","search_type":"fileFolder","folder_id":"","query":"","file_type":"","maximum_results":100}),
      ConnectorDescriptor("limit","logic","Limit","Limit the number of input items","logic","action",True,("maximum","items"),{"operation":"limit","maximum_items":1}),
      ConnectorDescriptor("google_drive_download","google_drive","Download File","Download a file from Google Drive","data","action",True,("drive","file"),{"provider":"google_drive","operation":"download","credential_id":"google_drive_default","file_id":"{{$json.files[0].id}}"}),
      ConnectorDescriptor("google_drive_delete","google_drive","Delete File","Delete a selected Google Drive file","data","action",True,("drive","file","remove"),{"provider":"google_drive","operation":"delete","credential_id":"google_drive_default","file_id":"{{$node[\"Download File\"].output.file_id}}","delete_only_if_previous_succeeded":True}),
      ConnectorDescriptor("http_request","http","HTTP Request","Call a web endpoint","data","action",True,("api","web"),{"operation":"request","method":"GET","url":""}),
      ConnectorDescriptor("read_file","file","Read File","Read a permitted local file","data","action",True,("upload",),{"operation":"read_file","file_path":"{{$json.file_path}}"}),
      ConnectorDescriptor("write_file","file","Write File","Write a permitted local file","data","action",False),
      ConnectorDescriptor("text_data","data","Text","Set structured text data","data","action",True,("set","json"),{"text":""}),
      ConnectorDescriptor("json_data","data","JSON","Set structured JSON data","data","action",True,("set",),{"value":{}}),
      ConnectorDescriptor("if_else","logic","If / Else","Branch on a condition","logic","action",False),
      ConnectorDescriptor("delay","logic","Delay","Wait before continuing","logic","action",False),
      ConnectorDescriptor("filter","logic","Filter","Filter structured data","logic","action",False),
      ConnectorDescriptor("merge","logic","Merge","Merge branches","logic","action",False),
    )
    for d in descriptors:
        factory=None
        if d.id=="http_request": factory=HttpConnector
        elif d.id=="read_file": factory=lambda: FileConnector(Path(allowed_root or Path.cwd()))
        elif d.id=="ask_jarvis": factory=lambda: JarvisCoreConnector(jarvis_process)
        registry.register(d,factory)
    return registry
