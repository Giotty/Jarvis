import sys, pathlib, unittest, types
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'voice'))
import accessibility

class Pattern:
    def __init__(self):self.Value='';self.IsReadOnly=False
    def SetValue(self,value):self.Value=value
class Control:
    def __init__(self,name,kind='ComboBoxControl'):
        self.Name=name;self.ControlTypeName=kind;self.IsPassword=False;self.HasKeyboardFocus=False;self.pattern=Pattern()
    def GetValuePattern(self):return self.pattern
    def SetFocus(self):self.HasKeyboardFocus=True
class AccessibilityTests(unittest.TestCase):
    def test_navigation_reports_actual_browser_address_change(self):
        field=Control('Search','ButtonControl')
        field.BoundingRectangle=types.SimpleNamespace(left=10,right=30,top=10,bottom=30)
        window={'application':'chrome.exe','hwnd':10};after={**window,'url':'youtube.com/results?search_query=MrBeast'}
        with patch.object(accessibility,'controls',return_value=iter([field])),patch.dict(sys.modules,{'pyautogui':types.SimpleNamespace(click=lambda x,y:None)}),patch('automation.foreground',return_value=window),patch('browser_control.state',side_effect=[{'windows':[{**window,'url':'youtube.com'}]},{'windows':[after]}]):
            result=accessibility.navigate('Search')
            self.assertTrue(result['verified']);self.assertEqual(result['observed_result'],after)
    def test_navigation_does_not_claim_a_page_change_for_an_unchanged_address(self):
        field=Control('Search','ButtonControl')
        field.BoundingRectangle=types.SimpleNamespace(left=10,right=30,top=10,bottom=30)
        window={'application':'chrome.exe','hwnd':10,'url':'youtube.com'}
        with patch.object(accessibility,'controls',return_value=iter([field])),patch.dict(sys.modules,{'pyautogui':types.SimpleNamespace(click=lambda x,y:None)}),patch('automation.foreground',return_value=window),patch('browser_control.state',return_value={'windows':[window]}):
            self.assertFalse(accessibility.navigate('Search').get('verified',False))
    def test_failed_accessibility_focus_uses_only_verified_field_center_when_mouse_allowed(self):
        field=Control('Rechercher');field.SetFocus=lambda:None
        field.BoundingRectangle=types.SimpleNamespace(left=10,right=90,top=20,bottom=40)
        clicks=[]
        def click(x,y):clicks.append((x,y));field.HasKeyboardFocus=True
        ui=types.SimpleNamespace(GetFocusedControl=lambda:field)
        window={'application':'chrome.exe','hwnd':10,'bounds':{'x':0,'y':0,'width':100,'height':100}}
        with patch.dict(sys.modules,{'uiautomation':ui,'pyautogui':types.SimpleNamespace(click=click)}),patch('automation.foreground',return_value=window):
            self.assertTrue(accessibility.fill('MrBeast',allow_mouse_focus=True)['verified'])
            self.assertEqual(clicks,[(50,30)])
    def test_disabled_mouse_permission_never_falls_back_to_a_click(self):
        field=Control('Search');field.SetFocus=lambda:None
        ui=types.SimpleNamespace(GetFocusedControl=lambda:field)
        with patch.dict(sys.modules,{'uiautomation':ui}),patch('automation.foreground',return_value={'application':'chrome.exe','hwnd':10}):
            with self.assertRaisesRegex(RuntimeError,'receive focus'):accessibility.fill('MrBeast')
            self.assertEqual(field.pattern.Value,'')
    def test_focus_on_inner_editor_is_accepted_only_when_its_parent_is_the_selected_field(self):
        field=Control('Search');field.GetRuntimeId=lambda:[1,2]
        child=types.SimpleNamespace(GetRuntimeId=lambda:[1,3],GetParentControl=lambda:field)
        self.assertTrue(accessibility.focus_within(field,types.SimpleNamespace(GetFocusedControl=lambda:child)))
    def test_localized_search_combobox_excludes_address_bar(self):
        page=Control('Rech.');address=Control("Barre d'adresse et de recherche",'EditControl')
        with patch.object(accessibility,'controls',return_value=iter([address,page])):
            self.assertIs(accessibility.find_edit('Search'),page)
    def test_typing_reads_back_value_without_submit(self):
        field=Control('Rechercher');ui=types.SimpleNamespace(GetFocusedControl=lambda:field)
        window={'application':'chrome.exe','hwnd':10}
        with patch.dict(sys.modules,{'uiautomation':ui}),patch('automation.foreground',return_value=window):
            result=accessibility.fill('MrBeast')
            self.assertTrue(result['verified']);self.assertFalse(result['submitted']);self.assertEqual(field.pattern.Value,'MrBeast')
    def test_changed_foreground_never_gets_text(self):
        field=Control('Search');ui=types.SimpleNamespace(GetFocusedControl=lambda:field)
        with patch.dict(sys.modules,{'uiautomation':ui}),patch('automation.foreground',side_effect=[{'application':'chrome.exe','hwnd':10},{'application':'chrome.exe','hwnd':11}]):
            with self.assertRaisesRegex(RuntimeError,'window changed'):accessibility.fill('MrBeast')
            self.assertEqual(field.pattern.Value,'')
    def test_sensitive_input_is_guarded(self):
        field=Control('Command','EditControl');ui=types.SimpleNamespace(GetFocusedControl=lambda:field)
        with patch.dict(sys.modules,{'uiautomation':ui}),patch('automation.foreground',return_value={'application':'powershell.exe','hwnd':10}):
            result=accessibility.fill('Get-Date');self.assertFalse(result['success']);self.assertEqual(field.pattern.Value,'')
    def test_ambiguous_search_fields_require_a_specific_target(self):
        with patch.object(accessibility,'controls',return_value=iter([Control('Search'),Control('Search')])):
            with self.assertRaisesRegex(RuntimeError,'unique'):accessibility.find_edit('Search')
if __name__=='__main__':unittest.main()
