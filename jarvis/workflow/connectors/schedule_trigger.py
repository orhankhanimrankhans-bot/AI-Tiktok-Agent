"""Validated multi-rule Schedule Trigger connector."""
from __future__ import annotations
import calendar,re
from datetime import datetime,timezone
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from .base import BaseConnector

INTERVAL_TYPES=("seconds","minutes","hours","days","weeks","months","cron")
DISPLAY_TYPES=("Seconds","Minutes","Hours","Days","Weeks","Months","Custom (Cron)")
WEEKDAYS=("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")

def default_rules():
    return [
        {"interval_type":"seconds","seconds":30},
        {"interval_type":"days","days":1,"hour":0,"minute":0},
    ]

def normalize_settings(settings: dict) -> dict:
    result=dict(settings or {})
    if not isinstance(result.get("rules"),list) or not result["rules"]:
        legacy=str(result.get("interval") or "daily").casefold()
        every=max(1,int(result.get("every") or 1))
        hour,minute=0,0
        try: hour,minute=(int(part) for part in str(result.get("time") or "00:00").split(":",1))
        except ValueError: pass
        mapping={"every_x_minutes":"minutes","hourly":"hours","daily":"days","weekly":"weeks","monthly":"months","custom":"cron"}
        kind=mapping.get(legacy,legacy if legacy in INTERVAL_TYPES else "days")
        rule={"interval_type":kind,kind if kind not in {"cron","hours"} else ("hours" if kind=="hours" else "cron_expression"):every}
        if kind=="cron": rule["cron_expression"]=str(result.get("cron_expression") or "* * * * *")
        if kind in {"hours","days","weeks","months"}: rule.update({"minute":minute})
        if kind in {"days","weeks","months"}: rule.update({"hour":hour})
        if kind=="weeks": rule["weekdays"]=[WEEKDAYS[int(result.get("weekday",0))%7]]
        if kind=="months": rule["day_of_month"]=int(result.get("day_of_month",1))
        result["rules"]=[rule]
    result.setdefault("timezone","local"); result.setdefault("enabled",True)
    return result

def _integer(rule,key,minimum,maximum):
    try: value=int(rule.get(key))
    except (TypeError,ValueError): raise ValueError(f"{key.replace('_',' ').title()} must be a whole number.") from None
    if not minimum<=value<=maximum: raise ValueError(f"{key.replace('_',' ').title()} must be in range {minimum}–{maximum}.")
    return value

def _cron_field_valid(field,minimum,maximum):
    for part in field.split(","):
        base,_,step=part.partition("/")
        if step and (not step.isdigit() or int(step)<1): return False
        if base=="*": continue
        bounds=base.split("-")
        if not all(item.isdigit() and minimum<=int(item)<=maximum for item in bounds) or len(bounds)>2: return False
    return True

def validate_cron(expression: str) -> None:
    fields=str(expression).split()
    if len(fields)!=5: raise ValueError("Cron expression must contain five fields: minute hour day month weekday.")
    for field,minimum,maximum in zip(fields,(0,0,1,1,0),(59,23,31,12,7)):
        if not _cron_field_valid(field,minimum,maximum): raise ValueError(f"Invalid cron field: {field}")

def validate_rule(rule: dict) -> dict:
    kind=str(rule.get("interval_type") or "").casefold()
    if kind not in INTERVAL_TYPES: raise ValueError(f"Unsupported trigger interval: {kind or 'not selected'}.")
    clean=dict(rule); clean["interval_type"]=kind
    if kind in {"seconds","minutes"}: clean[kind]=_integer(rule,kind,1,59)
    elif kind=="hours": clean["hours"]=_integer(rule,"hours",1,168); clean["minute"]=_integer(rule,"minute",0,59)
    elif kind=="days": clean["days"]=_integer(rule,"days",1,365); clean["hour"]=_integer(rule,"hour",0,23); clean["minute"]=_integer(rule,"minute",0,59)
    elif kind=="weeks":
        clean["weeks"]=_integer(rule,"weeks",1,52); clean["hour"]=_integer(rule,"hour",0,23); clean["minute"]=_integer(rule,"minute",0,59)
        weekdays=rule.get("weekdays") or []
        if isinstance(weekdays,str): weekdays=[item.strip().title() for item in weekdays.split(",") if item.strip()]
        if not weekdays or any(day not in WEEKDAYS for day in weekdays): raise ValueError("Weeks requires at least one valid weekday.")
        clean["weekdays"]=weekdays
    elif kind=="months":
        clean["months"]=_integer(rule,"months",1,120); clean["day_of_month"]=_integer(rule,"day_of_month",1,31); clean["hour"]=_integer(rule,"hour",0,23); clean["minute"]=_integer(rule,"minute",0,59)
    else: clean["cron_expression"]=str(rule.get("cron_expression") or "").strip(); validate_cron(clean["cron_expression"])
    return clean

def _cron_match(value,field):
    for part in field.split(","):
        base,_,step=part.partition("/"); step=int(step or 1)
        if base=="*" and value%step==0: return True
        if "-" in base:
            start,end=(int(item) for item in base.split("-",1))
            if start<=value<=end and (value-start)%step==0: return True
        elif base.isdigit() and value==int(base): return True
    return False

class ScheduleTriggerConnector(BaseConnector):
    def operations(self): return ("test","scheduled")
    def validate(self,settings):
        normalized=normalize_settings(settings)
        rules=[validate_rule(rule) for rule in normalized["rules"]]
        timezone_name=str(normalized.get("timezone") or "local")
        if timezone_name!="local":
            try: ZoneInfo(timezone_name)
            except ZoneInfoNotFoundError as exc: raise ValueError(f"Unknown schedule timezone: {timezone_name}") from exc
        return {**normalized,"rules":rules}
    def _now(self,settings,now=None):
        if now is not None: return now
        name=settings.get("timezone","local")
        return datetime.now().astimezone() if name=="local" else datetime.now(ZoneInfo(name))
    def payload(self,settings,rule_index=0,now=None,test_run=False):
        clean=self.validate(settings); rules=clean["rules"]
        if not 0<=rule_index<len(rules): raise ValueError("Schedule rule index is out of range.")
        current=self._now(clean,now)
        return {"trigger":"schedule","rule_index":rule_index,"interval_type":rules[rule_index]["interval_type"],"executed_at":current.isoformat(),"scheduled":True,"test_run":bool(test_run)}
    def due_event(self,settings,now=None):
        clean=self.validate(settings)
        if not clean.get("enabled",True): return None
        current=self._now(clean,now)
        epoch=int(current.timestamp())
        for index,rule in enumerate(clean["rules"]):
            kind=rule["interval_type"]; due=False; slot=""
            if kind=="seconds": due=epoch%rule["seconds"]==0; slot=f"second:{epoch}"
            elif kind=="minutes": due=current.second==0 and int(current.timestamp()//60)%rule["minutes"]==0; slot=f"minute:{int(current.timestamp()//60)}"
            elif kind=="hours": due=current.minute==rule["minute"] and current.second==0 and int(current.timestamp()//3600)%rule["hours"]==0; slot=f"hour:{current:%Y%m%d%H}"
            elif kind=="days": due=current.hour==rule["hour"] and current.minute==rule["minute"] and current.second==0 and current.toordinal()%rule["days"]==0; slot=f"day:{current:%Y%m%d}"
            elif kind=="weeks":
                week=int(current.strftime("%G%V")); due=WEEKDAYS[current.weekday()] in rule["weekdays"] and current.hour==rule["hour"] and current.minute==rule["minute"] and current.second==0 and week%rule["weeks"]==0; slot=f"week:{current:%G%V}-{current.weekday()}"
            elif kind=="months":
                month_index=current.year*12+current.month-1; last=calendar.monthrange(current.year,current.month)[1]; day=min(rule["day_of_month"],last)
                due=current.day==day and current.hour==rule["hour"] and current.minute==rule["minute"] and current.second==0 and month_index%rule["months"]==0; slot=f"month:{current:%Y%m}"
            else:
                minute,hour,day,month,weekday=rule["cron_expression"].split(); cron_weekday=(current.weekday()+1)%7
                due=current.second==0 and all((_cron_match(value,field) for value,field in ((current.minute,minute),(current.hour,hour),(current.day,day),(current.month,month),(cron_weekday,weekday)))); slot=f"cron:{current:%Y%m%d%H%M}"
            if due: return slot+f":rule:{index}",self.payload(clean,index,current,False)
        return None
    def execute(self,operation,config,input_data,context):
        payload=config.get("_schedule_payload") if operation=="scheduled" else None
        output={**input_data,**(payload or self.payload(config,0,test_run=True))}
        if operation=="test" and isinstance(config.get("_mock_data"),dict): output.update(config["_mock_data"])
        return output
