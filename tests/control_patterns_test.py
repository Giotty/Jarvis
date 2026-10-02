import sys,pathlib,unittest,types
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'voice'))
import accessibility
class Control:
    def __init__(self,name,kind='ButtonControl',identity=1):
        self.Name=name;self.ControlTypeName=kind;self.AutomationId='control';self.identity=identity
        self.IsPassword=False;self.BoundingRectangle=types.SimpleNamespace(left=10,right=50,top=20,bottom=40)
        self.pattern=None;self.parent=None
    def GetRuntimeId(self):return [self.identity]
    def GetInvokePattern(self):return self.pattern
    def GetSelectionItemPattern(self):return self.pattern
    def GetParentControl(self):return self.parent
def observed(control):
    return {'label':control.Name,'kind':control.ControlTypeName,'runtimeId':[control.identity],
            'x':30,'y':30,'source':'Windows UI Automation'}
class PatternTests(unittest.TestCase):
    def test_menu_and_tab_not_crowded_out_by_text(self):
        text=[Control('Text '+str(i),'TextControl',i+20) for i in range(180)]
        menu=Control('LIBRARY','MenuItemControl')
        with patch.object(accessibility,'controls',return_value=iter(text+[menu])):
            result=accessibility.describe()
        self.assertEqual(result['elements'][0]['kind'],'MenuItemControl')
        self.assertEqual(len(result['elements']),160)
    def test_child_label_keeps_consequential_parent_name(self):
        text=Control('Account','TextControl');text.parent=Control('Delete account')
        with patch.object(accessibility,'controls',return_value=iter([text])):
            self.assertEqual(accessibility.describe()['elements'][0]['actionLabel'],'Delete account')
    def test_failed_parent_lookup_never_reuses_the_previous_controls_context(self):
        first=Control('Account','TextControl');first.parent=Control('Delete account')
        second=Control('Library')
        def failed_parent():raise RuntimeError('provider unavailable')
        second.GetParentControl=failed_parent
        with patch.object(accessibility,'controls',return_value=iter([first,second])):
            item=next(c for c in accessibility.describe()['elements'] if c['label']=='Library')
        self.assertNotIn('actionLabel',item)
        self.assertTrue(item['contextUnavailable'])
    def test_tab_selection_is_read_back(self):
        c=Control('Collections','TabItemControl');pattern=types.SimpleNamespace(IsSelected=False)
        pattern.Select=lambda:setattr(pattern,'IsSelected',True);c.pattern=pattern
        with patch.object(accessibility,'controls',return_value=iter([c])):
            self.assertTrue(accessibility.activate_observed(observed(c))['verified'])
    def test_invoke_dispatch_does_not_invent_a_page_change(self):
        c=Control('Reports');calls=[];c.pattern=types.SimpleNamespace(Invoke=lambda:calls.append(1))
        with patch.object(accessibility,'controls',return_value=iter([c])):
            self.assertFalse(accessibility.activate_observed(observed(c))['verified'])
        self.assertEqual(calls,[1])
    def test_invoke_failure_is_never_followed_by_a_second_activation(self):
        c=Control('Reports')
        def failed():raise RuntimeError('provider failed after acting')
        c.pattern=types.SimpleNamespace(Invoke=failed)
        with patch.object(accessibility,'controls',return_value=iter([c])):
            with self.assertRaisesRegex(RuntimeError,'observe again'):accessibility.activate_observed(observed(c))
    def test_same_runtime_id_with_changed_label_or_position_is_stale(self):
        for mutation in ['label','position']:
            c=Control('Reports');known=observed(c)
            if mutation=='label':c.Name='Delete'
            else:c.BoundingRectangle=types.SimpleNamespace(left=70,right=110,top=20,bottom=40)
            with patch.object(accessibility,'controls',return_value=iter([c])):
                with self.assertRaisesRegex(RuntimeError,'changed'):accessibility.activate_observed(known)
if __name__=='__main__':unittest.main()
