import sys,pathlib,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'voice'))
from audio_control import control,state
class Endpoint:
    def __init__(self,value=.5,muted=False):self.value=value;self.muted=muted
    def GetMasterVolumeLevelScalar(self):return self.value
    def SetMasterVolumeLevelScalar(self,value,_):self.value=value
    def GetMute(self):return self.muted
    def SetMute(self,value,_):self.muted=bool(value)
class AudioTests(unittest.TestCase):
    def test_absolute_relative_and_boundaries(self):
        endpoint=Endpoint()
        for action,percent,expected in [('lower',10,40),('raise',80,100),('set',23,23),('lower',50,0)]:
            result=control({'action':action,'percent':percent},endpoint)
            self.assertTrue(result['verified']);self.assertEqual(result['observed_result']['volume'],expected)
    def test_mute_controls_and_preservation(self):
        endpoint=Endpoint(muted=True)
        self.assertTrue(control({'action':'set','percent':20},endpoint)['observed_result']['muted'])
        self.assertFalse(control({'action':'unmute'},endpoint)['observed_result']['muted'])
        self.assertTrue(control({'action':'toggle_mute'},endpoint)['observed_result']['muted'])
    def test_invalid_values_have_no_effect(self):
        endpoint=Endpoint()
        for value in [101,-1,float('nan'),True,'20']:
            with self.assertRaises(ValueError):control({'action':'set','percent':value},endpoint)
        self.assertEqual(state(endpoint)['volume'],50)
    def test_no_false_success_when_windows_does_not_apply_volume(self):
        endpoint=Endpoint();endpoint.SetMasterVolumeLevelScalar=lambda value,unused:None
        self.assertFalse(control({'action':'lower','percent':10},endpoint)['success'])
if __name__=='__main__':unittest.main()
